export type CaseStatus =
  | "draft"
  | "collecting_information"
  | "ready_for_confirmation"
  | "executing"
  | "waiting_external"
  | "completed"
  | "needs_user"
  | "needs_human"
  | "blocked"
  | "cancelled"
  | "expired";

export type DelegationStatus = "active" | "revoked" | "expired";
export type ConversationStatus = "active" | "closed";
export type ConversationActor = "principal" | "agent" | "system" | "counterparty" | "human_operator";
export type ConversationModality = "text" | "audio";
export type TaskStatus = "pending" | "running" | "waiting_external" | "completed" | "failed" | "cancelled";
export type AttemptStatus = "started" | "waiting_external" | "succeeded" | "failed";
export type ArtifactVerificationStatus = "pending" | "verified" | "rejected";
export type CalendarSyncStatus = "pending" | "synced" | "failed";
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface RepositoryDependencies {
  clock: () => Date;
  idGenerator: (entity: CaseEntityKind) => string;
}

export type CaseEntityKind =
  | "principal"
  | "subject"
  | "delegation"
  | "conversation"
  | "turn"
  | "case"
  | "field"
  | "task"
  | "attempt"
  | "consent"
  | "artifact"
  | "calendar_projection";

export interface CreatePrincipalInput {
  tenantId: string;
  displayName: string;
  locale: string;
  timezone: string;
}

export interface CreateSubjectInput {
  tenantId: string;
  principalId: string;
  relationship: string;
  displayName: string;
  birthDate?: Date;
  relationshipVerifiedAt?: Date;
}

export interface CreateDelegationInput {
  tenantId: string;
  principalId: string;
  subjectId: string;
  scope: string[];
  status?: DelegationStatus;
  validFrom?: Date;
  validUntil?: Date;
}

export interface CreateCaseFieldInput {
  key: string;
  valueEncrypted: string;
  source: string;
  confidence?: number;
  confirmedAt?: Date;
}

export interface CreateCaseInput {
  tenantId: string;
  principalId: string;
  subjectId: string;
  type: string;
  goal: string;
  priority?: number;
  counterpartyId?: string;
  dueAt?: Date;
  fields?: CreateCaseFieldInput[];
}

export interface CreateConversationInput {
  tenantId: string;
  principalId: string;
  caseId?: string;
  channel: "text";
  status?: ConversationStatus;
}

export interface AppendConversationTurnInput {
  tenantId: string;
  conversationId: string;
  actor: ConversationActor;
  modality: ConversationModality;
  text: string;
  transcriptConfidence?: number;
  correlationId: string;
}

export interface CreateTaskInput {
  tenantId: string;
  caseId: string;
  type: "search_appointment" | "book_appointment";
  status?: TaskStatus;
  requiredInputs: string[];
  outputContract: JsonValue;
  attemptLimit: number;
  assignedAdapter: string;
}

export interface CreateAttemptInput {
  tenantId: string;
  taskId: string;
  sequence: number;
  channel: string;
  status?: AttemptStatus;
  idempotencyKey: string;
  correlationId: string;
  endedAt?: Date;
  failureCode?: string;
  retryable?: boolean;
  externalReference?: string;
}

export interface CreateArtifactInput {
  tenantId: string;
  caseId: string;
  type: string;
  storageKey: string;
  mimeType: string;
  checksum: string;
  source: string;
  verificationStatus?: ArtifactVerificationStatus;
}

export interface CreateCalendarProjectionInput {
  tenantId: string;
  caseId: string;
  provider: string;
  eventKey: string;
  externalEventId?: string;
  idempotencyKey: string;
  startsAt: Date;
  endsAt: Date;
  syncStatus?: CalendarSyncStatus;
  failureCode?: string;
  lastSyncedAt?: Date;
}

export class CaseRepositoryError extends Error {
  constructor(
    public readonly code:
      | "PRINCIPAL_NOT_FOUND"
      | "SUBJECT_NOT_FOUND"
      | "SUBJECT_PRINCIPAL_MISMATCH"
      | "CASE_NOT_FOUND"
      | "CASE_PRINCIPAL_MISMATCH"
      | "CONVERSATION_NOT_FOUND"
      | "TASK_NOT_FOUND"
      | "CONSENT_NOT_FOUND"
      | "IDEMPOTENCY_KEY_CONFLICT"
      | "CALENDAR_PROJECTION_CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "CaseRepositoryError";
  }
}
