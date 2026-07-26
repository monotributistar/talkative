-- Additive migration for the medical appointment representative MVP.

CREATE TABLE "Principal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Principal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "relationshipVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "caseId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastTurnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "transcriptConfidence" DOUBLE PRECISION,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "counterpartyId" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CaseField" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueEncrypted" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CaseField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requiredInputs" JSONB NOT NULL,
    "outputContract" JSONB NOT NULL,
    "attemptLimit" INTEGER NOT NULL,
    "assignedAdapter" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "retryable" BOOLEAN,
    "externalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "dataCategories" JSONB NOT NULL,
    "counterpartyId" TEXT,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarProjection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "externalEventId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "syncStatus" TEXT NOT NULL,
    "failureCode" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CalendarProjection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Principal_tenantId_idx" ON "Principal"("tenantId");
CREATE UNIQUE INDEX "Principal_tenantId_id_key" ON "Principal"("tenantId", "id");
CREATE INDEX "Subject_tenantId_principalId_idx" ON "Subject"("tenantId", "principalId");
CREATE UNIQUE INDEX "Subject_tenantId_id_key" ON "Subject"("tenantId", "id");
CREATE UNIQUE INDEX "Subject_tenantId_id_principalId_key" ON "Subject"("tenantId", "id", "principalId");
CREATE INDEX "Delegation_tenantId_principalId_subjectId_idx" ON "Delegation"("tenantId", "principalId", "subjectId");
CREATE INDEX "Delegation_tenantId_status_validUntil_idx" ON "Delegation"("tenantId", "status", "validUntil");
CREATE UNIQUE INDEX "Delegation_tenantId_id_key" ON "Delegation"("tenantId", "id");
CREATE INDEX "Conversation_tenantId_principalId_status_idx" ON "Conversation"("tenantId", "principalId", "status");
CREATE INDEX "Conversation_tenantId_caseId_idx" ON "Conversation"("tenantId", "caseId");
CREATE UNIQUE INDEX "Conversation_tenantId_id_key" ON "Conversation"("tenantId", "id");
CREATE INDEX "ConversationTurn_tenantId_conversationId_createdAt_idx" ON "ConversationTurn"("tenantId", "conversationId", "createdAt");
CREATE INDEX "ConversationTurn_tenantId_correlationId_idx" ON "ConversationTurn"("tenantId", "correlationId");
CREATE UNIQUE INDEX "ConversationTurn_tenantId_id_key" ON "ConversationTurn"("tenantId", "id");
CREATE INDEX "Case_tenantId_principalId_status_idx" ON "Case"("tenantId", "principalId", "status");
CREATE INDEX "Case_tenantId_subjectId_status_idx" ON "Case"("tenantId", "subjectId", "status");
CREATE UNIQUE INDEX "Case_tenantId_id_key" ON "Case"("tenantId", "id");
CREATE INDEX "CaseField_tenantId_caseId_idx" ON "CaseField"("tenantId", "caseId");
CREATE UNIQUE INDEX "CaseField_tenantId_id_key" ON "CaseField"("tenantId", "id");
CREATE UNIQUE INDEX "CaseField_tenantId_caseId_key_key" ON "CaseField"("tenantId", "caseId", "key");
CREATE INDEX "Task_tenantId_caseId_status_idx" ON "Task"("tenantId", "caseId", "status");
CREATE UNIQUE INDEX "Task_tenantId_id_key" ON "Task"("tenantId", "id");
CREATE INDEX "Attempt_tenantId_taskId_status_idx" ON "Attempt"("tenantId", "taskId", "status");
CREATE INDEX "Attempt_tenantId_correlationId_idx" ON "Attempt"("tenantId", "correlationId");
CREATE UNIQUE INDEX "Attempt_tenantId_id_key" ON "Attempt"("tenantId", "id");
CREATE UNIQUE INDEX "Attempt_tenantId_idempotencyKey_key" ON "Attempt"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "Attempt_tenantId_taskId_sequence_key" ON "Attempt"("tenantId", "taskId", "sequence");
CREATE INDEX "Consent_tenantId_caseId_scope_status_idx" ON "Consent"("tenantId", "caseId", "scope", "status");
CREATE INDEX "Consent_tenantId_expiresAt_idx" ON "Consent"("tenantId", "expiresAt");
CREATE UNIQUE INDEX "Consent_tenantId_id_key" ON "Consent"("tenantId", "id");
CREATE INDEX "Artifact_tenantId_caseId_type_idx" ON "Artifact"("tenantId", "caseId", "type");
CREATE INDEX "Artifact_tenantId_checksum_idx" ON "Artifact"("tenantId", "checksum");
CREATE UNIQUE INDEX "Artifact_tenantId_id_key" ON "Artifact"("tenantId", "id");
CREATE UNIQUE INDEX "Artifact_tenantId_storageKey_key" ON "Artifact"("tenantId", "storageKey");
CREATE INDEX "CalendarProjection_tenantId_caseId_syncStatus_idx" ON "CalendarProjection"("tenantId", "caseId", "syncStatus");
CREATE UNIQUE INDEX "CalendarProjection_tenantId_id_key" ON "CalendarProjection"("tenantId", "id");
CREATE UNIQUE INDEX "CalendarProjection_tenantId_provider_eventKey_key" ON "CalendarProjection"("tenantId", "provider", "eventKey");
CREATE UNIQUE INDEX "CalendarProjection_tenantId_idempotencyKey_key" ON "CalendarProjection"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "CalendarProjection_tenantId_caseId_provider_key" ON "CalendarProjection"("tenantId", "caseId", "provider");

ALTER TABLE "Subject" ADD CONSTRAINT "Subject_tenantId_principalId_fkey"
FOREIGN KEY ("tenantId", "principalId") REFERENCES "Principal"("tenantId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_tenantId_principalId_fkey"
FOREIGN KEY ("tenantId", "principalId") REFERENCES "Principal"("tenantId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_tenantId_subjectId_principalId_fkey"
FOREIGN KEY ("tenantId", "subjectId", "principalId") REFERENCES "Subject"("tenantId", "id", "principalId")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_principalId_fkey"
FOREIGN KEY ("tenantId", "principalId") REFERENCES "Principal"("tenantId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_caseId_fkey"
FOREIGN KEY ("tenantId", "caseId") REFERENCES "Case"("tenantId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_tenantId_conversationId_fkey"
FOREIGN KEY ("tenantId", "conversationId") REFERENCES "Conversation"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_tenantId_principalId_fkey"
FOREIGN KEY ("tenantId", "principalId") REFERENCES "Principal"("tenantId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_tenantId_subjectId_principalId_fkey"
FOREIGN KEY ("tenantId", "subjectId", "principalId") REFERENCES "Subject"("tenantId", "id", "principalId")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseField" ADD CONSTRAINT "CaseField_tenantId_caseId_fkey"
FOREIGN KEY ("tenantId", "caseId") REFERENCES "Case"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_caseId_fkey"
FOREIGN KEY ("tenantId", "caseId") REFERENCES "Case"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_tenantId_taskId_fkey"
FOREIGN KEY ("tenantId", "taskId") REFERENCES "Task"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_tenantId_caseId_fkey"
FOREIGN KEY ("tenantId", "caseId") REFERENCES "Case"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_tenantId_caseId_fkey"
FOREIGN KEY ("tenantId", "caseId") REFERENCES "Case"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarProjection" ADD CONSTRAINT "CalendarProjection_tenantId_caseId_fkey"
FOREIGN KEY ("tenantId", "caseId") REFERENCES "Case"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
