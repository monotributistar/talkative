import { appendUsage, getBudgets, getRules } from "./store.js";

/**
 * Log a router usage record with basic token estimation.
 */
export async function logRouterUsage(input: {
  tenant_id: string;
  agent_id: string;
  prompt: string;
  response?: string;
  modelHint?: string;
  latency_ms: number;
  status: "ok" | "error";
}): Promise<void> {
  const rules = await getRules();
  const model = input.modelHint ?? rules.default_model;

  const tokens = Math.max(1, Math.ceil(input.prompt.length / 4));
  const cost = Number((tokens * 0.0000015).toFixed(6));

  await appendUsage({
    tenant_id: input.tenant_id,
    agent_id: input.agent_id,
    model,
    tokens,
    cost,
    latency_ms: input.latency_ms,
    status: input.status
  });
}

export async function isOverBudget(tenant_id: string, agent_id: string): Promise<boolean> {
  const budgets = await getBudgets();
  const tenantBudget = budgets.tenants[tenant_id];
  const agentBudget = budgets.agents[agent_id];

  return Boolean(!tenantBudget && !agentBudget);
}
