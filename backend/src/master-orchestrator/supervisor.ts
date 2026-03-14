// ═══════════════════════════════════════════════════════════
// Supervisor — Executes a TaskPlan via AgentHub
// ═══════════════════════════════════════════════════════════
//
// Takes a validated TaskPlan and executes each subtask
// sequentially by delegating to agents through AgentHub.
// Emits events to the existing orchestrator event store.

import { nanoid } from "nanoid";
import { agentHub } from "../agents/agentHub.js";
import { appendCommand, appendEvent, listRuns } from "../orchestrator/store.js";
import {
  TaskPlan,
  SubTask,
  MasterRunRecord,
  SupervisorConfig,
  DEFAULT_SUPERVISOR_CONFIG,
  WorkflowHealth,
  AgentHealthStatus,
} from "./types.js";

// ── Helpers ────────────────────────────────────────────────

/**
 * Topological sort of subtasks respecting dependencies.
 * Falls back to priority ordering for independent tasks.
 */
function orderSubtasks(subtasks: SubTask[]): SubTask[] {
  const result: SubTask[] = [];
  const done = new Set<string>();
  const remaining = [...subtasks];

  while (remaining.length > 0) {
    const ready = remaining.filter((st) =>
      st.dependencies.every((dep) => done.has(dep))
    );

    if (ready.length === 0) {
      // Shouldn't happen if validation passed (no cycles)
      throw new Error("Supervisor: cannot resolve subtask ordering — possible circular dependency");
    }

    // Sort ready tasks by priority (lower = first)
    ready.sort((a, b) => a.priority - b.priority);

    for (const st of ready) {
      result.push(st);
      done.add(st.id);
      const idx = remaining.indexOf(st);
      remaining.splice(idx, 1);
    }
  }

  return result;
}

/**
 * Wait for a promise with a timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout: ${label} exceeded ${ms}ms`));
    }, ms);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function getLatestRunIdForAgent(tenant_id: string, agent_id: string): Promise<string | null> {
  const runs = await listRuns({ tenant_id, agent_id, limit: 20 });
  if (runs.length === 0) return null;
  const latest = runs.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return latest?.run_id ?? null;
}

// ── Core ───────────────────────────────────────────────────

/**
 * Execute a TaskPlan sequentially.
 *
 * For each subtask:
 * 1. Emit "subtask_delegated" event
 * 2. Call agentHub.sendMessage() to the target agent
 * 3. Evaluate result
 * 4. Emit "subtask_completed" or "subtask_failed"
 * 5. On failure: abort remaining subtasks
 *
 * Returns a MasterRunRecord with the full execution trace.
 */
export async function executePlan(
  plan: TaskPlan,
  config: SupervisorConfig = DEFAULT_SUPERVISOR_CONFIG
): Promise<MasterRunRecord> {
  const run_id = `master-${nanoid(10)}`;
  const agent_id = "master-orchestrator";
  const child_run_ids: string[] = [];
  const startTime = Date.now();

  // Emit plan_created
  await appendEvent({
    tenant_id: plan.tenant_id,
    agent_id,
    run_id,
    type: "plan_created",
    message: `Plan ${plan.plan_id} created with ${plan.subtasks.length} subtask(s)`,
    payload: { plan_id: plan.plan_id, subtask_count: plan.subtasks.length },
  });

  // Order subtasks
  const ordered = orderSubtasks(plan.subtasks);

  let aborted = false;

  for (const subtask of ordered) {
    if (aborted) {
      subtask.status = "skipped";
      await appendEvent({
        tenant_id: plan.tenant_id,
        agent_id,
        run_id,
        type: "subtask_skipped",
        message: `Subtask ${subtask.id} skipped (previous failure)`,
        payload: { subtask_id: subtask.id, plan_id: plan.plan_id },
      });
      continue;
    }

    // Delegate
    subtask.status = "delegated";
    subtask.delegated_at = new Date().toISOString();

    await appendCommand({
      tenant_id: plan.tenant_id,
      agent_id,
      run_id,
      type: "delegate_subtask",
      payload: {
        subtask_id: subtask.id,
        target_agent_id: subtask.target_agent_id,
        description: subtask.description,
        plan_id: plan.plan_id,
      },
    });

    await appendEvent({
      tenant_id: plan.tenant_id,
      agent_id,
      run_id,
      type: "subtask_delegated",
      message: `Subtask ${subtask.id} delegated to ${subtask.target_agent_id}`,
      payload: { subtask_id: subtask.id, target_agent_id: subtask.target_agent_id },
    });

    // Execute via AgentHub
    try {
      const response = await withTimeout(
        agentHub.sendMessage(subtask.target_agent_id, subtask.description, plan.tenant_id),
        config.subtask_timeout_ms,
        `subtask ${subtask.id}`
      );

      subtask.status = "completed";
      subtask.completed_at = new Date().toISOString();
      subtask.duration_ms = Date.now() - new Date(subtask.delegated_at).getTime();
      subtask.result = response.reply;

      const childRunId = await getLatestRunIdForAgent(plan.tenant_id, subtask.target_agent_id);
      if (childRunId) {
        child_run_ids.push(childRunId);
      }

      await appendEvent({
        tenant_id: plan.tenant_id,
        agent_id,
        run_id,
        type: "subtask_completed",
        message: `Subtask ${subtask.id} completed by ${subtask.target_agent_id}`,
        payload: {
          subtask_id: subtask.id,
          target_agent_id: subtask.target_agent_id,
          duration_ms: subtask.duration_ms,
          // Store summary only, not full response (token safety)
          result_preview: (response.reply ?? "").slice(0, 500),
        },
      });
    } catch (error) {
      subtask.status = "failed";
      subtask.completed_at = new Date().toISOString();
      subtask.duration_ms = Date.now() - new Date(subtask.delegated_at).getTime();
      subtask.error = (error as Error).message;
      aborted = true;

      await appendEvent({
        tenant_id: plan.tenant_id,
        agent_id,
        run_id,
        type: "subtask_failed",
        message: `Subtask ${subtask.id} failed: ${subtask.error}`,
        payload: {
          subtask_id: subtask.id,
          target_agent_id: subtask.target_agent_id,
          error: subtask.error,
          duration_ms: subtask.duration_ms,
        },
      });
    }
  }

  // Build health snapshot
  const health = buildWorkflowHealth(plan);

  // Emit workflow_evaluated
  await appendEvent({
    tenant_id: plan.tenant_id,
    agent_id,
    run_id,
    type: "workflow_evaluated",
    message: `Workflow ${plan.plan_id} ${health.overall_status}: ${health.completed}/${health.total_subtasks} completed`,
    payload: {
      plan_id: plan.plan_id,
      overall_status: health.overall_status,
      completed: health.completed,
      failed: health.failed,
      duration_ms: Date.now() - startTime,
    },
  });

  // Build summary
  const completedTasks = plan.subtasks.filter((st) => st.status === "completed");
  const final_summary = completedTasks.length > 0
    ? completedTasks.map((st) => `[${st.id}] ${st.result?.slice(0, 200) ?? "done"}`).join("\n")
    : "No subtasks completed.";

  // Build MasterRunRecord
  const masterRun: MasterRunRecord = {
    run_id,
    tenant_id: plan.tenant_id,
    agent_id,
    status: health.overall_status === "completed" ? "completed" : "failed",
    subagent_state: "idle",
    created_at: new Date(startTime).toISOString(),
    updated_at: new Date().toISOString(),
    steps: [], // Steps are in the event store
    is_master: true,
    plan_id: plan.plan_id,
    child_run_ids,
    plan_snapshot: plan,
    health_snapshot: health,
    final_summary,
  };

  return masterRun;
}

// ── Health ─────────────────────────────────────────────────

function buildWorkflowHealth(plan: TaskPlan): WorkflowHealth {
  const completed = plan.subtasks.filter((st) => st.status === "completed").length;
  const failed = plan.subtasks.filter((st) => st.status === "failed").length;

  // Aggregate per-agent health from subtask results
  const agentMap = new Map<string, { successes: number; failures: number; totalMs: number; lastError?: string }>();

  for (const st of plan.subtasks) {
    if (st.status === "pending" || st.status === "skipped") continue;

    const existing = agentMap.get(st.target_agent_id) ?? { successes: 0, failures: 0, totalMs: 0 };

    if (st.status === "completed") {
      existing.successes++;
    } else if (st.status === "failed") {
      existing.failures++;
      existing.lastError = st.error;
    }
    existing.totalMs += st.duration_ms ?? 0;
    agentMap.set(st.target_agent_id, existing);
  }

  const agent_health: AgentHealthStatus[] = Array.from(agentMap.entries()).map(([id, stats]) => {
    const total = stats.successes + stats.failures;
    return {
      agent_id: id,
      name: id, // Could resolve from AgentHub
      status: stats.failures > 0 ? "degraded" : "healthy",
      success_rate: total > 0 ? stats.successes / total : 0,
      avg_response_time_ms: total > 0 ? stats.totalMs / total : 0,
      last_error: stats.lastError,
      total_invocations: total,
    };
  });

  const overall_duration_ms = plan.subtasks.reduce((sum, st) => sum + (st.duration_ms ?? 0), 0);

  let overall_status: WorkflowHealth["overall_status"];
  if (failed === 0 && completed === plan.subtasks.length) {
    overall_status = "completed";
  } else if (completed > 0) {
    overall_status = "partial";
  } else {
    overall_status = "failed";
  }

  return {
    plan_id: plan.plan_id,
    total_subtasks: plan.subtasks.length,
    completed,
    failed,
    overall_duration_ms,
    agent_health,
    overall_status,
  };
}
