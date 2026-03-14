// ═══════════════════════════════════════════════════════════
// Master Orchestrator — Type Contracts
// ═══════════════════════════════════════════════════════════
//
// These types define the contract for hierarchical agent
// orchestration. They extend the existing orchestrator types
// without modifying them.
//
// Design doc: docs/design-master-orchestrator.md

import type { RunRecord } from "../orchestrator/types.js";

// ── Execution ──────────────────────────────────────────────

export type ExecutionStrategy = "sequential" | "parallel";

export type SubTaskStatus = "pending" | "delegated" | "completed" | "failed" | "skipped";

export interface SubTask {
  /** Unique within a plan, e.g. "st-1", "st-2" */
  id: string;

  /** What this subtask should accomplish */
  description: string;

  /** Which agent handles it (must exist in AgentHub) */
  target_agent_id: string;

  /** IDs of subtasks that must complete before this one starts */
  dependencies: string[];

  /** Lower = higher priority. Used to order independent subtasks */
  priority: number;

  /** Current status */
  status: SubTaskStatus;

  /** Result from the agent (set on completion) */
  result?: string;

  /** Error message (set on failure) */
  error?: string;

  /** Timing */
  delegated_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

// ── Plan ───────────────────────────────────────────────────

export interface TaskPlan {
  plan_id: string;
  tenant_id: string;

  /** The original user request that generated this plan */
  original_request: string;

  /** Decomposed subtasks */
  subtasks: SubTask[];

  /** How to execute: sequential (v1) or parallel (future) */
  strategy: ExecutionStrategy;

  created_at: string;

  /** "planner" or agent_id that created the plan */
  created_by: string;
}

// ── Master Run ─────────────────────────────────────────────

export interface MasterRunRecord extends RunRecord {
  /** Discriminator — always true for master runs */
  is_master: true;

  /** Reference to the plan being executed */
  plan_id: string;

  /** Run IDs of child agent executions */
  child_run_ids: string[];

  /** Snapshot of the plan at execution time */
  plan_snapshot: TaskPlan;

  /** Health snapshot at completion (optional) */
  health_snapshot?: WorkflowHealth;

  /** LLM-generated summary of the workflow result */
  final_summary?: string;
}

// ── Health ─────────────────────────────────────────────────

export interface AgentHealthStatus {
  agent_id: string;
  name: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  success_rate: number;
  avg_response_time_ms: number;
  last_error?: string;
  last_active?: string;
  total_invocations: number;
}

export interface WorkflowHealth {
  plan_id: string;
  total_subtasks: number;
  completed: number;
  failed: number;
  overall_duration_ms: number;
  agent_health: AgentHealthStatus[];
  overall_status: "completed" | "partial" | "failed";
}

// ── Commands & Events (extend existing orchestrator) ───────

export type MasterCommandType =
  | "delegate_subtask"
  | "evaluate_result";

export type MasterEventType =
  | "plan_created"
  | "subtask_delegated"
  | "subtask_completed"
  | "subtask_failed"
  | "subtask_skipped"
  | "workflow_evaluated"
  | "health_check";

// ── Planner I/O ────────────────────────────────────────────

/** What the Planner receives */
export interface PlannerInput {
  request: string;
  tenant_id: string;
  /** Available agents with their skills, injected by caller */
  available_agents: Array<{
    id: string;
    name: string;
    skills: string[];
  }>;
}

/** What the LLM should return (structured output) */
export interface PlannerLLMResponse {
  subtasks: Array<{
    id: string;
    description: string;
    target_agent_id: string;
    dependencies: string[];
    priority: number;
  }>;
  strategy: ExecutionStrategy;
}

// ── Supervisor Config ──────────────────────────────────────

export interface SupervisorConfig {
  /** Max time to wait for a single subtask (ms). Default: 60000 */
  subtask_timeout_ms: number;

  /** Max subtasks allowed in a plan. Hardcoded safety cap. */
  max_subtasks: number;

  /** Whether to call LLM to evaluate each subtask result */
  evaluate_results: boolean;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  subtask_timeout_ms: 60_000,
  max_subtasks: 10,
  evaluate_results: false,
};
