export type TaskExecutorErrorCode =
  | "NOT_FOUND"
  | "INVALID_COMMAND"
  | "TASK_NOT_EXECUTABLE"
  | "TASK_IN_PROGRESS"
  | "ADAPTER_NOT_REGISTERED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "NOT_AUTHORIZED"
  | "CONCURRENT_UPDATE"
  | "EVIDENCE_INVALID";

export class TaskExecutorError extends Error {
  constructor(
    public readonly code: TaskExecutorErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TaskExecutorError";
  }
}
