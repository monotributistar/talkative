import { Router } from "express";
import { getTenantIdOrThrow } from "../tenancy/guard.js";
import { agentHub } from "../agents/agentHub.js";
import { createPlan } from "../master-orchestrator/planner.js";
import { executePlan } from "../master-orchestrator/supervisor.js";
import type { TaskPlan } from "../master-orchestrator/types.js";
import { checkAgentHealth, getSystemOverview } from "../master-orchestrator/healthMonitor.js";
import { getRun } from "../orchestrator/store.js";

export const masterOrchestratorRouter = Router();

function isTaskPlan(input: unknown): input is TaskPlan {
  if (!input || typeof input !== "object") return false;
  const plan = input as Partial<TaskPlan>;
  return (
    typeof plan.plan_id === "string" &&
    typeof plan.tenant_id === "string" &&
    typeof plan.original_request === "string" &&
    Array.isArray(plan.subtasks)
  );
}

// ── Plan ───────────────────────────────────────────────────

/**
 * POST /orchestrator/plan
 * Create a plan from a user request (does NOT execute).
 */
masterOrchestratorRouter.post("/orchestrator/plan", async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const { request } = req.body as { request?: string };

    if (!request) {
      return res.status(400).json({ error: "request is required" });
    }

    // Gather available agents with their skills
    const agents = agentHub.listAgents({ tenant_id });
    const available_agents = await Promise.all(
      agents.map(async (a) => {
        const skills = await agentHub.getAgentSkills(a.id, tenant_id);
        return {
          id: a.agent_id,
          name: a.name,
          skills: skills.map((s) => s.id),
        };
      })
    );

    if (available_agents.length === 0) {
      return res.status(400).json({ error: "No agents available for planning" });
    }

    const plan = await createPlan({ request, tenant_id, available_agents });
    return res.status(201).json(plan);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /orchestrator/plan/:plan_id/execute
 * Execute an existing plan.
 *
 * Note: For v1 simplicity, the plan is passed in the body
 * (since we don't persist plans yet). In the future,
 * plans could be stored and looked up by ID.
 */
masterOrchestratorRouter.post("/orchestrator/plan/:plan_id/execute", async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const { plan } = req.body as { plan?: unknown };

    if (!plan) {
      return res.status(400).json({ error: "plan is required in body (plan persistence not yet implemented)" });
    }

    if (!isTaskPlan(plan)) {
      return res.status(400).json({ error: "Invalid plan payload" });
    }

    if (plan.plan_id !== req.params.plan_id) {
      return res.status(400).json({ error: "plan_id path param does not match body plan.plan_id" });
    }

    if (plan.tenant_id !== tenant_id) {
      return res.status(403).json({ error: "Plan tenant does not match authenticated tenant" });
    }

    const result = await executePlan(plan);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /orchestrator/run
 * Shortcut: create plan + execute in one call.
 */
masterOrchestratorRouter.post("/orchestrator/run", async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const { request } = req.body as { request?: string };

    if (!request) {
      return res.status(400).json({ error: "request is required" });
    }

    const agents = agentHub.listAgents({ tenant_id });
    const available_agents = await Promise.all(
      agents.map(async (a) => {
        const skills = await agentHub.getAgentSkills(a.id, tenant_id);
        return {
          id: a.agent_id,
          name: a.name,
          skills: skills.map((s) => s.id),
        };
      })
    );

    if (available_agents.length === 0) {
      return res.status(400).json({ error: "No agents available" });
    }

    const plan = await createPlan({ request, tenant_id, available_agents });
    const result = await executePlan(plan);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── Trace ──────────────────────────────────────────────────

/**
 * GET /orchestrator/runs/:run_id/trace
 * Get the full hierarchical trace of a master run.
 */
masterOrchestratorRouter.get("/orchestrator/runs/:run_id/trace", async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const run = await getRun(req.params.run_id, tenant_id);

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    return res.json(run);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── Health ─────────────────────────────────────────────────

/**
 * GET /orchestrator/health
 * System-wide health overview.
 */
masterOrchestratorRouter.get("/orchestrator/health", async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const overview = await getSystemOverview(tenant_id);
    return res.json(overview);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /orchestrator/health/:agent_id
 * Health for a specific agent.
 */
masterOrchestratorRouter.get("/orchestrator/health/:agent_id", async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const health = await checkAgentHealth(req.params.agent_id, tenant_id);
    return res.json(health);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});
