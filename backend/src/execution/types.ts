import type { AdapterResult, AppointmentAdapter, TaskCommand } from "../adapters/types.js";

export type TaskExecutionDecision =
  | "completed"
  | "retry_scheduled"
  | "waiting_external"
  | "needs_user"
  | "needs_human";

export interface PersistedAttempt {
  id: string;
  tenantId: string;
  taskId: string;
  sequence: number;
  channel: string;
  status: string;
  idempotencyKey: string;
  correlationId: string;
  startedAt: Date;
  endedAt: Date | null;
  failureCode: string | null;
  retryable: boolean | null;
  externalReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskExecutionOutcome {
  attempt: PersistedAttempt | null;
  result: AdapterResult | null;
  decision: TaskExecutionDecision;
  handoffReason?: "ATTEMPTS_EXHAUSTED";
  replayed: boolean;
}

export interface EvidenceVerifyingAppointmentAdapter extends AppointmentAdapter {
  getEvidence(reference: string): { type: string; reference: string } | undefined;
  verifyEvidence(reference: string, checksum: string): boolean;
}

export type AppointmentAdapterRegistry = Readonly<
  Record<string, EvidenceVerifyingAppointmentAdapter>
>;

export { type AdapterResult, type TaskCommand };
