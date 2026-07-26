import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaCaseRepository } from "./repository.js";
import { CaseRepositoryError } from "./types.js";

type Row = Record<string, any>;

class FakeCasePrisma {
  private readonly principals: Row[] = [];
  private readonly subjects: Row[] = [];
  private readonly delegations: Row[] = [];
  private readonly cases: Row[] = [];
  private readonly fields: Row[] = [];
  private readonly conversations: Row[] = [];
  private readonly turns: Row[] = [];
  private readonly tasks: Row[] = [];
  private readonly attempts: Row[] = [];
  private readonly consents: Row[] = [];
  private readonly artifacts: Row[] = [];
  private readonly calendarProjections: Row[] = [];

  principal: any;
  subject: any;
  delegation: any;
  case: any;
  conversation: any;
  conversationTurn: any;
  task: any;
  attempt: any;
  consent: any;
  artifact: any;
  calendarProjection: any;

  constructor() {
    this.principal = {
      create: async ({ data }: Row) => this.insert(this.principals, data),
      findFirst: async ({ where }: Row) => this.find(this.principals, where)
    };
    this.subject = {
      create: async ({ data }: Row) => this.insert(this.subjects, data),
      findFirst: async ({ where }: Row) => this.find(this.subjects, where)
    };
    this.delegation = {
      create: async ({ data }: Row) => this.insert(this.delegations, data),
      findMany: async ({ where }: Row) => this.findMany(this.delegations, where)
    };
    this.case = {
      create: async ({ data }: Row) => {
        const { fields, ...caseData } = data;
        const created = this.insert(this.cases, caseData);
        for (const field of fields?.create ?? []) {
          this.insert(this.fields, { ...field, caseId: created.id });
        }
        return created;
      },
      findFirst: async ({ where, include }: Row) => {
        const found = this.find(this.cases, where);
        if (!found || !include) return found;
        return {
          ...found,
          principal: this.find(this.principals, {
            tenantId: found.tenantId,
            id: found.principalId
          }),
          subject: this.find(this.subjects, {
            tenantId: found.tenantId,
            id: found.subjectId
          }),
          fields: this.findMany(this.fields, {
            tenantId: found.tenantId,
            caseId: found.id
          }),
          conversations: this.findMany(this.conversations, {
            tenantId: found.tenantId,
            caseId: found.id
          }).map((conversation) => ({
            ...conversation,
            turns: this.findMany(this.turns, {
              tenantId: found.tenantId,
              conversationId: conversation.id
            })
          })),
          tasks: this.findMany(this.tasks, {
            tenantId: found.tenantId,
            caseId: found.id
          }).map((task) => ({
            ...task,
            attempts: this.findMany(this.attempts, {
              tenantId: found.tenantId,
              taskId: task.id
            })
          })),
          consents: this.findMany(this.consents, {
            tenantId: found.tenantId,
            caseId: found.id
          }),
          artifacts: this.findMany(this.artifacts, {
            tenantId: found.tenantId,
            caseId: found.id
          }),
          calendarProjections: this.findMany(this.calendarProjections, {
            tenantId: found.tenantId,
            caseId: found.id
          })
        };
      }
    };
    this.conversation = {
      create: async ({ data }: Row) => this.insert(this.conversations, data),
      findFirst: async ({ where }: Row) => this.find(this.conversations, where),
      update: async ({ where, data }: Row) => {
        const found = this.find(this.conversations, where.tenantId_id ?? where);
        if (!found) throw new Error("Conversation not found");
        Object.assign(found, data);
        return { ...found };
      }
    };
    this.conversationTurn = {
      create: async ({ data }: Row) => this.insert(this.turns, data)
    };
    this.task = {
      create: async ({ data }: Row) => this.insert(this.tasks, data),
      findFirst: async ({ where }: Row) => this.find(this.tasks, where)
    };
    this.attempt = {
      create: async ({ data }: Row) => this.insert(this.attempts, data),
      findUnique: async ({ where }: Row) =>
        this.find(this.attempts, this.unwrapCompoundWhere(where))
    };
    this.consent = {
      create: async ({ data }: Row) => this.insert(this.consents, data),
      findFirst: async ({ where }: Row) => this.find(this.consents, where),
      findMany: async ({ where }: Row) => this.findMany(this.consents, where),
      update: async ({ where, data }: Row) =>
        this.update(this.consents, this.unwrapCompoundWhere(where), data)
    };
    this.artifact = {
      create: async ({ data }: Row) => this.insert(this.artifacts, data)
    };
    this.calendarProjection = {
      create: async ({ data }: Row) => this.insert(this.calendarProjections, data),
      findUnique: async ({ where }: Row) =>
        this.find(this.calendarProjections, this.unwrapCompoundWhere(where))
    };
  }

  asClient(): PrismaClient {
    return this as unknown as PrismaClient;
  }

  attemptCount(): number {
    return this.attempts.length;
  }

  calendarProjectionCount(): number {
    return this.calendarProjections.length;
  }

  private insert(rows: Row[], data: Row): Row {
    const created = { ...data };
    rows.push(created);
    return { ...created };
  }

  private find(rows: Row[], where: Row): Row | null {
    const found = rows.find((row) =>
      Object.entries(where).every(([key, value]) => row[key] === value)
    );
    return found ? { ...found } : null;
  }

  private findMany(rows: Row[], where: Row): Row[] {
    return rows
      .filter((row) => Object.entries(where).every(([key, value]) => row[key] === value))
      .map((row) => ({ ...row }));
  }

  private update(rows: Row[], where: Row, data: Row): Row {
    const index = rows.findIndex((row) =>
      Object.entries(where).every(([key, value]) => row[key] === value)
    );
    if (index < 0) throw new Error("Record not found");
    rows[index] = { ...rows[index], ...data };
    return { ...rows[index] };
  }

  private unwrapCompoundWhere(where: Row): Row {
    const value = Object.values(where)[0];
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Row
      : where;
  }
}

const fixedNow = new Date("2026-07-24T15:00:00.000Z");

function createFixture() {
  const database = new FakeCasePrisma();
  const sequence = new Map<string, number>();
  const repository = new PrismaCaseRepository(database.asClient(), {
    clock: () => fixedNow,
    idGenerator: (entity) => {
      const next = (sequence.get(entity) ?? 0) + 1;
      sequence.set(entity, next);
      return `${entity}-${next}`;
    }
  });
  return { repository, database };
}

async function seedBasicCase(repository: PrismaCaseRepository, tenantId = "tenant-a") {
  const principal = await repository.createPrincipal({
    tenantId,
    displayName: "Synthetic Principal",
    locale: "es-AR",
    timezone: "UTC"
  });
  const subject = await repository.createSubject({
    tenantId,
    principalId: principal.id,
    relationship: "guardian",
    displayName: "Synthetic Dependent",
    relationshipVerifiedAt: fixedNow
  });
  const caseRecord = await repository.createCase({
    tenantId,
    principalId: principal.id,
    subjectId: subject.id,
    type: "medical_appointment",
    goal: "Coordinate a synthetic pediatric appointment"
  });
  return { principal, subject, caseRecord };
}

test("creates and retrieves a basic dossier with its relations for the correct tenant", async () => {
  const { repository } = createFixture();
  const principal = await repository.createPrincipal({
    tenantId: "tenant-a",
    displayName: "Synthetic Principal",
    locale: "es-AR",
    timezone: "America/Argentina/Buenos_Aires"
  });
  const subject = await repository.createSubject({
    tenantId: "tenant-a",
    principalId: principal.id,
    relationship: "guardian",
    displayName: "Synthetic Dependent",
    relationshipVerifiedAt: fixedNow
  });
  const delegation = await repository.createDelegation({
    tenantId: "tenant-a",
    principalId: principal.id,
    subjectId: subject.id,
    scope: ["coordinate_medical_appointment"]
  });
  const caseRecord = await repository.createCase({
    tenantId: "tenant-a",
    principalId: principal.id,
    subjectId: subject.id,
    type: "medical_appointment",
    goal: "Coordinate a synthetic pediatric appointment",
    fields: [
      {
        key: "specialty",
        valueEncrypted: "ciphertext:pediatrics",
        source: "principal",
        confirmedAt: fixedNow
      }
    ]
  });
  const conversation = await repository.createConversation({
    tenantId: "tenant-a",
    principalId: principal.id,
    caseId: caseRecord.id,
    channel: "text"
  });
  const turn = await repository.appendConversationTurn({
    tenantId: "tenant-a",
    conversationId: conversation.id,
    actor: "principal",
    modality: "text",
    text: "Synthetic request",
    correlationId: "corr-001"
  });

  const dossier = await repository.getCase("tenant-a", caseRecord.id);

  assert.ok(dossier);
  assert.equal(dossier.id, "case-1");
  assert.equal(dossier.createdAt.toISOString(), fixedNow.toISOString());
  assert.equal(dossier.principal.id, principal.id);
  assert.equal(dossier.subject.id, subject.id);
  assert.equal(dossier.fields.length, 1);
  assert.equal(dossier.delegations[0]?.id, delegation.id);
  assert.equal(dossier.conversations[0]?.id, conversation.id);
  assert.equal(dossier.conversations[0]?.turns[0]?.id, turn.id);
});

test("does not return a dossier across tenant boundaries", async () => {
  const { repository } = createFixture();
  const principal = await repository.createPrincipal({
    tenantId: "tenant-a",
    displayName: "Synthetic Principal",
    locale: "es-AR",
    timezone: "UTC"
  });
  const subject = await repository.createSubject({
    tenantId: "tenant-a",
    principalId: principal.id,
    relationship: "guardian",
    displayName: "Synthetic Dependent"
  });
  const caseRecord = await repository.createCase({
    tenantId: "tenant-a",
    principalId: principal.id,
    subjectId: subject.id,
    type: "medical_appointment",
    goal: "Synthetic goal"
  });

  assert.equal(await repository.getCase("tenant-b", caseRecord.id), null);
});

test("always creates a case in draft even if an untyped caller injects status", async () => {
  const { repository } = createFixture();
  const { principal, subject } = await seedBasicCase(repository);

  const injected = await repository.createCase({
    tenantId: "tenant-a",
    principalId: principal.id,
    subjectId: subject.id,
    type: "medical_appointment",
    goal: "Synthetic injected status regression",
    status: "completed"
  } as Parameters<PrismaCaseRepository["createCase"]>[0]);

  assert.equal(injected.status, "draft");
  assert.equal(injected.completedAt, undefined);
});

test("rejects a case when the subject belongs to a different principal", async () => {
  const { repository } = createFixture();
  const owner = await repository.createPrincipal({
    tenantId: "tenant-a",
    displayName: "Synthetic Owner",
    locale: "es-AR",
    timezone: "UTC"
  });
  const otherPrincipal = await repository.createPrincipal({
    tenantId: "tenant-a",
    displayName: "Synthetic Other",
    locale: "es-AR",
    timezone: "UTC"
  });
  const subject = await repository.createSubject({
    tenantId: "tenant-a",
    principalId: owner.id,
    relationship: "guardian",
    displayName: "Synthetic Dependent"
  });

  await assert.rejects(
    repository.createCase({
      tenantId: "tenant-a",
      principalId: otherPrincipal.id,
      subjectId: subject.id,
      type: "medical_appointment",
      goal: "Synthetic goal"
    }),
    (error: unknown) =>
      error instanceof CaseRepositoryError &&
      error.code === "SUBJECT_PRINCIPAL_MISMATCH"
  );
});

test("rejects conversation access from another tenant", async () => {
  const { repository } = createFixture();
  const principal = await repository.createPrincipal({
    tenantId: "tenant-a",
    displayName: "Synthetic Principal",
    locale: "es-AR",
    timezone: "UTC"
  });
  const conversation = await repository.createConversation({
    tenantId: "tenant-a",
    principalId: principal.id,
    channel: "text"
  });

  await assert.rejects(
    repository.appendConversationTurn({
      tenantId: "tenant-b",
      conversationId: conversation.id,
      actor: "principal",
      modality: "text",
      text: "Synthetic request",
      correlationId: "corr-tenant-boundary"
    }),
    (error: unknown) =>
      error instanceof CaseRepositoryError &&
      error.code === "CONVERSATION_NOT_FOUND"
  );
});

test("returns the same attempt for a repeated idempotency key without creating a duplicate", async () => {
  const { repository, database } = createFixture();
  const { caseRecord } = await seedBasicCase(repository);
  const task = await repository.createTask({
    tenantId: "tenant-a",
    caseId: caseRecord.id,
    type: "book_appointment",
    requiredInputs: ["subject_id", "slot_id"],
    outputContract: {
      contract_id: "medical_appointment",
      contract_version: "1.0.0"
    },
    attemptLimit: 3,
    assignedAdapter: "appointment-simulator"
  });
  const input = {
    tenantId: "tenant-a",
    taskId: task.id,
    sequence: 1,
    channel: "simulator",
    idempotencyKey: "appointment:case-1:slot-001",
    correlationId: "corr-attempt-001"
  };

  const first = await repository.createAttemptIdempotent(input);
  const repeated = await repository.createAttemptIdempotent(input);

  assert.equal(repeated.id, first.id);
  assert.equal(database.attemptCount(), 1);
});

test("rejects reusing an attempt idempotency key for another task", async () => {
  const { repository } = createFixture();
  const { caseRecord } = await seedBasicCase(repository);
  const firstTask = await repository.createTask({
    tenantId: "tenant-a",
    caseId: caseRecord.id,
    type: "search_appointment",
    requiredInputs: ["subject_id"],
    outputContract: { contract_id: "availability" },
    attemptLimit: 2,
    assignedAdapter: "appointment-simulator"
  });
  const secondTask = await repository.createTask({
    tenantId: "tenant-a",
    caseId: caseRecord.id,
    type: "book_appointment",
    requiredInputs: ["slot_id"],
    outputContract: { contract_id: "medical_appointment" },
    attemptLimit: 2,
    assignedAdapter: "appointment-simulator"
  });
  await repository.createAttemptIdempotent({
    tenantId: "tenant-a",
    taskId: firstTask.id,
    sequence: 1,
    channel: "simulator",
    idempotencyKey: "appointment:shared-key",
    correlationId: "corr-attempt-001"
  });

  await assert.rejects(
    repository.createAttemptIdempotent({
      tenantId: "tenant-a",
      taskId: secondTask.id,
      sequence: 1,
      channel: "simulator",
      idempotencyKey: "appointment:shared-key",
      correlationId: "corr-attempt-002"
    }),
    (error: unknown) =>
      error instanceof CaseRepositoryError &&
      error.code === "IDEMPOTENCY_KEY_CONFLICT"
  );
});

test("rejects reusing an attempt idempotency key with changed immutable input", async () => {
  const { repository, database } = createFixture();
  const { caseRecord } = await seedBasicCase(repository);
  const task = await repository.createTask({
    tenantId: "tenant-a",
    caseId: caseRecord.id,
    type: "book_appointment",
    requiredInputs: ["slot_id"],
    outputContract: { contract_id: "medical_appointment" },
    attemptLimit: 2,
    assignedAdapter: "appointment-simulator"
  });
  const input = {
    tenantId: "tenant-a",
    taskId: task.id,
    sequence: 1,
    channel: "simulator",
    idempotencyKey: "appointment:same-task:slot-001",
    correlationId: "corr-attempt-original"
  };
  await repository.createAttemptIdempotent(input);

  await assert.rejects(
    repository.createAttemptIdempotent({
      ...input,
      sequence: 2,
      correlationId: "corr-attempt-changed"
    }),
    (error: unknown) =>
      error instanceof CaseRepositoryError &&
      error.code === "IDEMPOTENCY_KEY_CONFLICT"
  );
  assert.equal(database.attemptCount(), 1);
});

test("keeps one calendar projection for the same provider and event", async () => {
  const { repository, database } = createFixture();
  const { caseRecord } = await seedBasicCase(repository);
  const input = {
    tenantId: "tenant-a",
    caseId: caseRecord.id,
    provider: "synthetic-calendar",
    eventKey: "appointment:confirmation-001",
    externalEventId: "event-synthetic-001",
    idempotencyKey: "calendar:case-1:confirmation-001",
    startsAt: new Date("2026-07-30T18:00:00.000Z"),
    endsAt: new Date("2026-07-30T18:30:00.000Z"),
    syncStatus: "synced" as const,
    lastSyncedAt: fixedNow
  };

  const first = await repository.createCalendarProjectionIdempotent(input);
  const repeated = await repository.createCalendarProjectionIdempotent(input);

  assert.equal(repeated.id, first.id);
  assert.equal(database.calendarProjectionCount(), 1);

  await assert.rejects(
    repository.createCalendarProjectionIdempotent({
      ...input,
      idempotencyKey: "calendar:case-1:conflicting-key"
    }),
    (error: unknown) =>
      error instanceof CaseRepositoryError &&
      error.code === "CALENDAR_PROJECTION_CONFLICT"
  );

  await assert.rejects(
    repository.createCalendarProjectionIdempotent({
      ...input,
      startsAt: new Date("2026-07-30T19:00:00.000Z"),
      endsAt: new Date("2026-07-30T19:30:00.000Z")
    }),
    (error: unknown) =>
      error instanceof CaseRepositoryError &&
      error.code === "CALENDAR_PROJECTION_CONFLICT"
  );
  assert.equal(database.calendarProjectionCount(), 1);
});

test("persists artifact evidence and exposes execution relations in the dossier", async () => {
  const { repository } = createFixture();
  const { caseRecord } = await seedBasicCase(repository);
  const task = await repository.createTask({
    tenantId: "tenant-a",
    caseId: caseRecord.id,
    type: "search_appointment",
    requiredInputs: ["subject_id"],
    outputContract: { contract_id: "availability" },
    attemptLimit: 2,
    assignedAdapter: "appointment-simulator"
  });
  const artifact = await repository.createArtifact({
    tenantId: "tenant-a",
    caseId: caseRecord.id,
    type: "appointment_confirmation",
    storageKey: "synthetic/case-1/confirmation.json",
    mimeType: "application/json",
    checksum: `sha256:${"a".repeat(64)}`,
    source: "appointment-simulator",
    verificationStatus: "verified"
  });

  const dossier = await repository.getCase("tenant-a", caseRecord.id);

  assert.equal(dossier?.tasks[0]?.id, task.id);
  assert.equal(dossier?.artifacts[0]?.id, artifact.id);
});
