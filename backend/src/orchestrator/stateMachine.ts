import { OrchestratorCommandType, OrchestratorEventType, RunStatus, SubagentState } from "./types.js";

export function reduceRunStatus(current: RunStatus, input: { command?: OrchestratorCommandType; event?: OrchestratorEventType }): RunStatus {
  if (input.command === "start_task") return "running";
  if (input.command === "pause" && current === "running") return "paused";
  if (input.command === "resume" && current === "paused") return "running";
  if (input.command === "cancel") return "cancelled";

  // Master Orchestrator commands
  if (input.command === "delegate_subtask" && current === "running") return "running";
  if (input.command === "evaluate_result" && current === "running") return "running";

  if (input.event === "error_compacted") return "failed";
  if (input.event === "tool_finished" && current === "running") return "running";

  // Master Orchestrator events
  if (input.event === "plan_created") return "running";
  if (input.event === "subtask_delegated" && current === "running") return "running";
  if (input.event === "subtask_completed" && current === "running") return "running";
  if (input.event === "subtask_failed") return "failed";
  if (input.event === "workflow_evaluated") return "completed";

  return current;
}

export function reduceSubagentState(
  current: SubagentState,
  input: { command?: OrchestratorCommandType; event?: OrchestratorEventType }
): SubagentState {
  if (input.command === "start_task" || input.command === "resume") return "running";
  if (input.command === "pause") return "paused";
  if (input.command === "cancel") return "stopped";

  // Master Orchestrator: delegate keeps subagent running
  if (input.command === "delegate_subtask") return "running";

  if (input.event === "tool_started") return "running";
  if (input.event === "subtask_delegated") return "running";
  if (input.event === "error_compacted" || input.event === "subtask_failed") return "error";
  if (input.event === "workflow_evaluated") return "idle";

  return current;
}
