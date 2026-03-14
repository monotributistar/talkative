// ═══════════════════════════════════════════════════════════
// Planner — LLM-driven task decomposition
// ═══════════════════════════════════════════════════════════
//
// Takes a user request + list of available agents.
// Calls the LLM to decompose the request into subtasks.
// Returns a validated TaskPlan ready for the Supervisor.

import { nanoid } from "nanoid";
import { chatCompletion } from "./llmClient.js";
import {
  TaskPlan,
  SubTask,
  PlannerInput,
  PlannerLLMResponse,
  DEFAULT_SUPERVISOR_CONFIG,
} from "./types.js";

// ── Prompt Template ────────────────────────────────────────

function buildPlannerPrompt(input: PlannerInput): string {
  const agentList = input.available_agents
    .map((a) => `- Agent "${a.name}" (id: ${a.id}), skills: [${a.skills.join(", ")}]`)
    .join("\n");

  return `You are a task planner for a multi-agent system.

Given the available agents and a user request, decompose the request into subtasks.
Each subtask must be assigned to exactly one agent.

Available agents:
${agentList}

User request: "${input.request}"

Respond ONLY with valid JSON matching this schema:
{
  "subtasks": [
    {
      "id": "st-1",
      "description": "what this subtask accomplishes",
      "target_agent_id": "the agent id that handles it",
      "dependencies": [],
      "priority": 1
    }
  ],
  "strategy": "sequential"
}

Rules:
- Only assign to agents listed above (use exact id).
- List dependency IDs if a subtask needs another's output.
- Keep subtasks atomic — one clear action each.
- Use a single subtask if the request is simple enough.
- Maximum ${DEFAULT_SUPERVISOR_CONFIG.max_subtasks} subtasks.
- strategy must be "sequential" (parallel not supported yet).`;
}

// ── Validation ─────────────────────────────────────────────

function validatePlannerResponse(
  raw: PlannerLLMResponse,
  availableAgentIds: Set<string>
): string[] {
  const errors: string[] = [];

  if (!Array.isArray(raw.subtasks) || raw.subtasks.length === 0) {
    errors.push("Plan has no subtasks");
    return errors;
  }

  if (raw.subtasks.length > DEFAULT_SUPERVISOR_CONFIG.max_subtasks) {
    errors.push(`Plan exceeds max subtasks (${raw.subtasks.length} > ${DEFAULT_SUPERVISOR_CONFIG.max_subtasks})`);
  }

  const ids = new Set<string>();
  for (const st of raw.subtasks) {
    if (ids.has(st.id)) {
      errors.push(`Duplicate subtask id: ${st.id}`);
    }
    ids.add(st.id);

    if (!availableAgentIds.has(st.target_agent_id)) {
      errors.push(`Subtask ${st.id} targets unknown agent: ${st.target_agent_id}`);
    }

    for (const dep of st.dependencies) {
      if (!ids.has(dep) && !raw.subtasks.some((s) => s.id === dep)) {
        errors.push(`Subtask ${st.id} depends on unknown subtask: ${dep}`);
      }
    }
  }

  // Check for circular dependencies (simple DFS)
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adjMap = new Map<string, string[]>();
  for (const st of raw.subtasks) {
    adjMap.set(st.id, st.dependencies);
  }

  function hasCycle(node: string): boolean {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const dep of adjMap.get(node) ?? []) {
      if (hasCycle(dep)) return true;
    }
    inStack.delete(node);
    return false;
  }

  for (const st of raw.subtasks) {
    if (hasCycle(st.id)) {
      errors.push("Plan contains circular dependencies");
      break;
    }
  }

  return errors;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Generate a TaskPlan from a user request using LLM decomposition.
 *
 * Throws if:
 * - LLM call fails
 * - LLM returns unparseable JSON
 * - Validation finds issues (bad agent IDs, cycles, etc.)
 */
export async function createPlan(input: PlannerInput): Promise<TaskPlan> {
  const prompt = buildPlannerPrompt(input);

  const response = await chatCompletion(
    [
      { role: "system", content: "You are a precise task planner. Respond only with valid JSON." },
      { role: "user", content: prompt },
    ],
    {
      temperature: 0.1,
      response_format: { type: "json_object" },
    }
  );

  // Parse LLM response (handle markdown wrappers some providers add)
  let parsed: PlannerLLMResponse;
  try {
    let raw = response.content.trim();
    // Strip ```json ... ``` wrappers if present
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    parsed = JSON.parse(raw) as PlannerLLMResponse;
  } catch {
    throw new Error(`Planner: LLM returned invalid JSON: ${response.content.slice(0, 200)}`);
  }

  // Validate
  const agentIds = new Set(input.available_agents.map((a) => a.id));
  const errors = validatePlannerResponse(parsed, agentIds);
  if (errors.length > 0) {
    throw new Error(`Planner validation failed:\n${errors.join("\n")}`);
  }

  // Build TaskPlan
  const plan_id = `plan-${nanoid(10)}`;
  const subtasks: SubTask[] = parsed.subtasks.map((st) => ({
    id: st.id,
    description: st.description,
    target_agent_id: st.target_agent_id,
    dependencies: st.dependencies,
    priority: st.priority,
    status: "pending",
  }));

  return {
    plan_id,
    tenant_id: input.tenant_id,
    original_request: input.request,
    subtasks,
    strategy: "sequential", // Force sequential for v1
    created_at: new Date().toISOString(),
    created_by: "planner",
  };
}
