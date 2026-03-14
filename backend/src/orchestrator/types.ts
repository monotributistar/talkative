export type OrchestratorCommandType =
  | "start_task" | "pause" | "resume" | "cancel" | "request_delegate"
  | "delegate_subtask" | "evaluate_result";

export type OrchestratorEventType =
  | "state_changed"
  | "tool_started"
  | "tool_finished"
  | "metric_recorded"
  | "error_compacted"
  // Master Orchestrator events
  | "plan_created"
  | "subtask_delegated"
  | "subtask_completed"
  | "subtask_failed"
  | "subtask_skipped"
  | "workflow_evaluated"
  | "health_check";

export type RunStatus = "pending" | "running" | "paused" | "cancelled" | "failed" | "completed";

export type SubagentState = "idle" | "running" | "paused" | "stopped" | "error";

export interface EnvelopeBase {
  id: string;
  tenant_id: string;
  agent_id: string;
  run_id: string;
  created_at: string;
}

export interface OrchestratorCommand extends EnvelopeBase {
  type: OrchestratorCommandType;
  payload?: Record<string, unknown>;
}

export interface OrchestratorEvent extends EnvelopeBase {
  type: OrchestratorEventType;
  message: string;
  payload?: Record<string, unknown>;
}

export interface RunStep {
  id: string;
  type: "command" | "event";
  name: string;
  at: string;
  payload?: Record<string, unknown>;
}

export interface RunRecord {
  run_id: string;
  tenant_id: string;
  agent_id: string;
  status: RunStatus;
  subagent_state: SubagentState;
  created_at: string;
  updated_at: string;
  last_error?: string;
  steps: RunStep[];
}
