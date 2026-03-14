// ═══════════════════════════════════════════════════════════
// Health Monitor — reads event store for health metrics
// ═══════════════════════════════════════════════════════════
//
// No separate storage. Reads existing orchestrator events
// and computes health stats on demand.

import { listRuns } from "../orchestrator/store.js";
import { agentHub } from "../agents/agentHub.js";
import { AgentHealthStatus } from "./types.js";

/**
 * Get health status for a specific agent by looking at recent runs.
 */
export async function checkAgentHealth(
  agent_id: string,
  tenant_id: string
): Promise<AgentHealthStatus> {
  const agent = agentHub.getAgent(agent_id, tenant_id);
  const runs = await listRuns({ tenant_id, agent_id, limit: 50 });

  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const total = completed + failed;

  const lastFailed = runs.find((r) => r.status === "failed");
  const lastRun = runs[runs.length - 1];

  return {
    agent_id,
    name: agent?.name ?? agent_id,
    status: total === 0 ? "unknown" : failed > total * 0.3 ? "degraded" : "healthy",
    success_rate: total > 0 ? completed / total : 0,
    avg_response_time_ms: 0, // Would need timing in events to calculate
    last_error: lastFailed?.last_error,
    last_active: lastRun?.updated_at,
    total_invocations: total,
  };
}

/**
 * Get a system-wide overview of all agents' health.
 */
export async function getSystemOverview(
  tenant_id: string
): Promise<{
  agents: AgentHealthStatus[];
  total_agents: number;
  healthy: number;
  degraded: number;
  down: number;
}> {
  const allAgents = agentHub.listAgents({ tenant_id });
  const healthStatuses: AgentHealthStatus[] = [];

  for (const agent of allAgents) {
    const health = await checkAgentHealth(agent.agent_id, tenant_id);
    healthStatuses.push(health);
  }

  return {
    agents: healthStatuses,
    total_agents: healthStatuses.length,
    healthy: healthStatuses.filter((a) => a.status === "healthy").length,
    degraded: healthStatuses.filter((a) => a.status === "degraded").length,
    down: healthStatuses.filter((a) => a.status === "down").length,
  };
}
