-- Baseline of the schema historically created with `prisma db push`.
-- Existing installations must mark this migration as applied before deploy.

CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspace" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "heartbeatMinutes" INTEGER NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentRef" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "note" TEXT,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RouterRule" (
    "id" TEXT NOT NULL,
    "defaultModel" TEXT NOT NULL,
    "routes" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RouterRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RouterBudget" (
    "id" TEXT NOT NULL,
    "globalDailyCostCapUsd" DOUBLE PRECISION NOT NULL,
    "tenants" JSONB NOT NULL,
    "agents" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RouterBudget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RouterUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RouterUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FleetNode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "cloudId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "sshHost" TEXT,
    "sshUser" TEXT,
    "sshPort" INTEGER,
    "basePath" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FleetNode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Agent_agentId_key" ON "Agent"("agentId");
CREATE INDEX "Agent_tenantId_idx" ON "Agent"("tenantId");
CREATE INDEX "AgentEvent_agentRef_timestamp_idx" ON "AgentEvent"("agentRef", "timestamp");
CREATE INDEX "AgentEvent_tenantId_agentId_idx" ON "AgentEvent"("tenantId", "agentId");
CREATE INDEX "Workflow_tenantId_idx" ON "Workflow"("tenantId");
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");
CREATE INDEX "RouterUsage_tenantId_agentId_createdAt_idx" ON "RouterUsage"("tenantId", "agentId", "createdAt");
CREATE INDEX "FleetNode_tenantId_cloudId_idx" ON "FleetNode"("tenantId", "cloudId");

ALTER TABLE "AgentEvent"
ADD CONSTRAINT "AgentEvent_agentRef_fkey"
FOREIGN KEY ("agentRef") REFERENCES "Agent"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowVersion"
ADD CONSTRAINT "WorkflowVersion_workflowId_fkey"
FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
