import assert from "node:assert/strict";
import test from "node:test";
import type { Attempt, PrismaClient } from "@prisma/client";
import type { AdapterResult, TaskCommand } from "../adapters/types.js";
import { ConsentManagerError } from "../cases/consent-manager.js";
import { TaskExecutorError } from "./errors.js";
import { TaskExecutor } from "./task-executor.js";
import type { EvidenceVerifyingAppointmentAdapter } from "./types.js";

const now = new Date("2026-07-25T15:00:00.000Z");
const checksum = `sha256:${"a".repeat(64)}` as const;

type CaseRow = {
  id: string;
  tenantId: string;
  subjectId: string;
  counterpartyId: string;
  type: string;
  status: string;
};

type TaskRow = {
  id: string;
  tenantId: string;
  caseId: string;
  type: string;
  status: string;
  requiredInputs: unknown;
  outputContract: unknown;
  attemptLimit: number;
  assignedAdapter: string;
  createdAt: Date;
  updatedAt: Date;
};

type ArtifactRow = {
  id: string;
  tenantId: string;
  caseId: string;
  type: string;
  storageKey: string;
  mimeType: string;
  checksum: string;
  source: string;
  verificationStatus: string;
  createdAt: Date;
};

class FakePrisma {
  readonly cases: CaseRow[] = [];
  readonly tasks: TaskRow[] = [];
  readonly attempts: Attempt[] = [];
  readonly artifacts: ArtifactRow[] = [];
  serializationFailures = 0;
  serializationFailure: unknown = { code: "P2034" };

  task: any;
  attempt: any;
  artifact: any;

  constructor() {
    this.task = {
      findFirst: async ({ where }: any) => {
        const row = this.tasks.find(
          (candidate) =>
            candidate.tenantId === where.tenantId && candidate.id === where.id
        );
        if (!row) return null;
        const caseRow = this.cases.find(
          (candidate) =>
            candidate.tenantId === row.tenantId && candidate.id === row.caseId
        );
        return caseRow ? { ...row, case: { ...caseRow } } : null;
      },
      updateMany: async ({ where, data }: any) => {
        const row = this.tasks.find(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            candidate.id === where.id &&
            matchesStatus(candidate.status, where.status)
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }
    };
    this.attempt = {
      findFirst: async ({ where, select }: any) => {
        const row = this.attempts.find(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.id === undefined || candidate.id === where.id) &&
            (where.taskId === undefined || candidate.taskId === where.taskId) &&
            (where.idempotencyKey === undefined ||
              candidate.idempotencyKey === where.idempotencyKey) &&
            matchesStatus(candidate.status, where.status)
        );
        if (!row) return null;
        if (select) return Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]]));
        return { ...row };
      },
      aggregate: async ({ where }: any) => {
        const rows = this.attempts.filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            candidate.taskId === where.taskId
        );
        return {
          _count: { _all: rows.length },
          _max: {
            sequence:
              rows.length === 0 ? null : Math.max(...rows.map((row) => row.sequence))
          }
        };
      },
      create: async ({ data }: any) => {
        if (
          this.attempts.some(
            (row) =>
              row.tenantId === data.tenantId &&
              (row.idempotencyKey === data.idempotencyKey ||
                (row.taskId === data.taskId && row.sequence === data.sequence))
          )
        ) {
          throw { code: "P2002" };
        }
        const row: Attempt = {
          endedAt: null,
          failureCode: null,
          retryable: null,
          externalReference: null,
          ...data
        };
        this.attempts.push(row);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const row = this.attempts.find(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            candidate.id === where.id &&
            (where.taskId === undefined || candidate.taskId === where.taskId) &&
            matchesStatus(candidate.status, where.status)
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }
    };
    this.artifact = {
      findFirst: async ({ where }: any) => {
        const row = this.artifacts.find(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.storageKey === undefined || candidate.storageKey === where.storageKey)
        );
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: any) =>
        this.artifacts
          .filter(
            (row) =>
              row.tenantId === where.tenantId &&
              row.caseId === where.caseId &&
              row.storageKey.startsWith(where.storageKey.startsWith) &&
              row.verificationStatus === where.verificationStatus
          )
          .map((row) => ({ ...row }))
          .sort((left, right) => left.storageKey.localeCompare(right.storageKey)),
      create: async ({ data }: any) => {
        if (
          this.artifacts.some(
            (row) =>
              row.tenantId === data.tenantId &&
              (row.id === data.id || row.storageKey === data.storageKey)
          )
        ) {
          throw { code: "P2002" };
        }
        this.artifacts.push({ ...data });
        return { ...data };
      }
    };
  }

  async $transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T> {
    if (this.serializationFailures > 0) {
      this.serializationFailures -= 1;
      throw this.serializationFailure;
    }
    return callback(this);
  }

  async $queryRaw(): Promise<unknown[]> {
    return [];
  }

  asClient(): PrismaClient {
    return this as unknown as PrismaClient;
  }
}

class StubAdapter implements EvidenceVerifyingAppointmentAdapter {
  calls = 0;
  readonly evidence = new Map<string, { type: string; reference: string }>();
  readonly results: Array<AdapterResult | (() => Promise<AdapterResult>)>;

  constructor(...results: Array<AdapterResult | (() => Promise<AdapterResult>)>) {
    this.results = [...results];
    for (const result of results) {
      if (typeof result !== "function" && result.status === "succeeded") {
        for (const item of result.evidence) {
          this.evidence.set(item.reference, {
            type: item.type,
            reference: item.reference
          });
        }
      }
    }
  }

  async execute(): Promise<AdapterResult> {
    this.calls += 1;
    const result = this.results.shift();
    if (!result) throw new Error("Missing stub result");
    return typeof result === "function" ? result() : structuredClone(result);
  }

  getEvidence(reference: string) {
    return this.evidence.get(reference);
  }

  verifyEvidence(reference: string, candidate: string): boolean {
    return this.evidence.has(reference) && candidate === checksum;
  }
}

function matchesStatus(value: string, predicate: unknown): boolean {
  if (predicate === undefined) return true;
  if (typeof predicate === "string") return value === predicate;
  return (
    typeof predicate === "object" &&
    predicate !== null &&
    "in" in predicate &&
    Array.isArray((predicate as { in: unknown }).in) &&
    ((predicate as { in: string[] }).in).includes(value)
  );
}

function success(
  type: "availability_options" | "appointment_confirmation" = "availability_options"
): AdapterResult {
  return {
    status: "succeeded",
    external_reference: "external-001",
    evidence: [{ type, reference: "evidence-001", checksum }]
  };
}

function command(overrides: Partial<TaskCommand> = {}): TaskCommand {
  return {
    command_id: "command-001",
    tenant_id: "tenant-a",
    case_id: "case-001",
    task_id: "task-001",
    type: "search_appointment",
    input: {
      subject_id: "subject-001",
      specialty: "pediatrics",
      preferred_date_range: { from: "2026-07-27", to: "2026-07-31" },
      preferred_time_range: { from: "14:00", to: "18:00" },
      counterparty_id: "clinic-001"
    },
    consent_id: "consent-001",
    idempotency_key: "idempotency-0001",
    correlation_id: "correlation-001",
    ...overrides
  };
}

function fixture(
  result: AdapterResult = success(),
  options: { caseStatus?: string; taskStatus?: string; attemptLimit?: number } = {}
) {
  const database = new FakePrisma();
  database.cases.push({
    id: "case-001",
    tenantId: "tenant-a",
    subjectId: "subject-001",
    counterpartyId: "clinic-001",
    type: "medical_appointment",
    status: options.caseStatus ?? "executing"
  });
  database.tasks.push({
    id: "task-001",
    tenantId: "tenant-a",
    caseId: "case-001",
    type: "search_appointment",
    status: options.taskStatus ?? "pending",
    requiredInputs: [],
    outputContract: {},
    attemptLimit: options.attemptLimit ?? 3,
    assignedAdapter: "clinic",
    createdAt: now,
    updatedAt: now
  });
  const adapter = new StubAdapter(result);
  let authorized = true;
  const transitions: Array<{ fromStatus: string; toStatus: string }> = [];
  const executor = new TaskExecutor(
    database.asClient(),
    { clinic: adapter },
    {
      clock: () => now,
      attemptId: (_tenant, key) => `attempt-${key.slice(-4)}`,
      artifactId: (_tenant, _attempt, reference) => `artifact-${reference}`,
      consentManager: () => ({
        authorizeMedicalAppointmentEffect: async () => {
          if (!authorized) {
            throw new ConsentManagerError("NOT_AUTHORIZED", "denied");
          }
          return {} as never;
        }
      }),
      caseManager: () => ({
        transition: async (input) => {
          const row = database.cases.find(
            (candidate) =>
              candidate.tenantId === input.tenantId &&
              candidate.id === input.caseId
          );
          if (!row || row.status !== input.fromStatus) {
            throw new Error("Unexpected case transition");
          }
          row.status = input.toStatus;
          transitions.push({
            fromStatus: input.fromStatus,
            toStatus: input.toStatus
          });
          return row as never;
        }
      })
    }
  );
  return {
    database,
    adapter,
    executor,
    transitions,
    revoke: () => {
      authorized = false;
    }
  };
}

test("authorized success persists one succeeded attempt and verified evidence", async () => {
  const { executor, database, adapter } = fixture();
  const outcome = await executor.execute(command());

  assert.equal(outcome.decision, "completed");
  assert.equal(outcome.attempt?.status, "succeeded");
  assert.equal(database.tasks[0]?.status, "completed");
  assert.equal(database.artifacts[0]?.verificationStatus, "verified");
  assert.equal(adapter.calls, 1);
  assert.equal(database.cases[0]?.status, "needs_user");
});

test("terminal replay returns persisted attempt without adapter or artifact duplication", async () => {
  const { executor, database, adapter } = fixture();
  await executor.execute(command());
  const replay = await executor.execute(command());

  assert.equal(replay.replayed, true);
  assert.equal(replay.result?.status, "succeeded");
  assert.equal(
    replay.result?.status === "succeeded" ? replay.result.evidence.length : 0,
    1
  );
  assert.equal(database.attempts.length, 1);
  assert.equal(database.artifacts.length, 1);
  assert.equal(adapter.calls, 1);
});

test("altered replay fingerprint conflicts without adapter call", async () => {
  const { executor, adapter } = fixture();
  await executor.execute(command());
  await assert.rejects(
    executor.execute(
      command({
        command_id: "command-002",
        input: { ...command().input, preferred_time_range: { from: "09:00", to: "10:00" } }
      })
    ),
    (error: unknown) =>
      error instanceof TaskExecutorError &&
      error.code === "IDEMPOTENCY_KEY_CONFLICT"
  );
  assert.equal(adapter.calls, 1);
});

test("revoked consent creates no attempt and never calls adapter", async () => {
  const state = fixture();
  state.revoke();
  await assert.rejects(
    state.executor.execute(command()),
    (error: unknown) =>
      error instanceof TaskExecutorError && error.code === "NOT_AUTHORIZED"
  );
  assert.equal(state.database.attempts.length, 0);
  assert.equal(state.adapter.calls, 0);
});

test("retryable failure with capacity schedules retry", async () => {
  const state = fixture({
    status: "failed",
    failure_code: "COUNTERPARTY_UNAVAILABLE",
    retryable: true
  });
  const outcome = await state.executor.execute(command());
  assert.equal(outcome.decision, "retry_scheduled");
  assert.equal(state.database.tasks[0]?.status, "pending");
  assert.equal(state.database.cases[0]?.status, "executing");
});

test("retryable final attempt preserves adapter failure and adds exhausted handoff", async () => {
  const state = fixture(
    { status: "failed", failure_code: "NO_AVAILABILITY", retryable: true },
    { attemptLimit: 1 }
  );
  const outcome = await state.executor.execute(command());
  assert.deepEqual(outcome.result, {
    status: "failed",
    failure_code: "NO_AVAILABILITY",
    retryable: true
  });
  assert.equal(outcome.decision, "needs_human");
  assert.equal(outcome.handoffReason, "ATTEMPTS_EXHAUSTED");
  assert.equal(state.database.cases[0]?.status, "needs_human");
});

test("pre-claim exhaustion uses persisted count, max sequence and no adapter result", async () => {
  const state = fixture(success(), { attemptLimit: 1 });
  state.database.attempts.push(seedAttempt({ sequence: 7, status: "failed" }));
  const outcome = await state.executor.execute(
    command({ idempotency_key: "idempotency-0002" })
  );
  assert.equal(outcome.attempt, null);
  assert.equal(outcome.result, null);
  assert.equal(outcome.decision, "needs_human");
  assert.equal(outcome.handoffReason, "ATTEMPTS_EXHAUSTED");
  assert.equal(state.database.tasks[0]?.status, "failed");
  assert.equal(state.adapter.calls, 0);
});

test("gapped sequences allocate max sequence plus one", async () => {
  const state = fixture(success(), { attemptLimit: 4 });
  state.database.attempts.push(seedAttempt({ sequence: 2, status: "failed" }));
  const outcome = await state.executor.execute(
    command({ idempotency_key: "idempotency-0002" })
  );
  assert.equal(outcome.attempt?.sequence, 3);
});

test("waiting external remains resumable and same-key replay may finish", async () => {
  const state = fixture({ status: "waiting_external", external_reference: "pending-001" });
  const second = success();
  state.adapter["results"].push(second);
  state.adapter.evidence.set("evidence-001", {
    type: "availability_options",
    reference: "evidence-001"
  });
  const first = await state.executor.execute(command());
  assert.equal(first.decision, "waiting_external");
  assert.equal(state.database.cases[0]?.status, "waiting_external");
  const replay = await state.executor.execute(command());
  assert.equal(replay.decision, "completed");
  assert.equal(state.adapter.calls, 2);
});

test("different key cannot overtake an attempt in flight", async () => {
  let release!: (result: AdapterResult) => void;
  const pending = new Promise<AdapterResult>((resolve) => {
    release = resolve;
  });
  const state = fixture(success());
  const blocking = new StubAdapter(() => pending);
  blocking.evidence.set("evidence-001", {
    type: "availability_options",
    reference: "evidence-001"
  });
  const executor = new TaskExecutor(state.database.asClient(), { clinic: blocking }, {
    clock: () => now,
    consentManager: () => ({ authorizeMedicalAppointmentEffect: async () => ({} as never) }),
    caseManager: () => ({
      transition: async (input) => {
        const row = state.database.cases[0]!;
        assert.equal(row.status, input.fromStatus);
        row.status = input.toStatus;
        return row as never;
      }
    })
  });
  const first = executor.execute(command());
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    executor.execute(command({ idempotency_key: "idempotency-0002" })),
    (error: unknown) =>
      error instanceof TaskExecutorError && error.code === "TASK_IN_PROGRESS"
  );
  release(success());
  await first;
  assert.equal(blocking.calls, 1);
  assert.equal(state.database.attempts.length, 1);
});

test("cross-tenant is not found and never calls adapter", async () => {
  const state = fixture();
  await assert.rejects(
    state.executor.execute(command({ tenant_id: "tenant-b" })),
    (error: unknown) =>
      error instanceof TaskExecutorError && error.code === "NOT_FOUND"
  );
  assert.equal(state.adapter.calls, 0);
});

for (const scenario of [
  {
    name: "needs_user",
    result: { status: "needs_user", missing_fields: ["slot_id"] } as AdapterResult,
    decision: "needs_user",
    caseStatus: "needs_user",
    taskStatus: "pending"
  },
  {
    name: "needs_human",
    result: {
      status: "needs_human",
      reason_code: "COUNTERPARTY_REQUIRES_CALL"
    } as AdapterResult,
    decision: "needs_human",
    caseStatus: "needs_human",
    taskStatus: "failed"
  },
  {
    name: "nonretryable user failure",
    result: {
      status: "failed",
      failure_code: "INVALID_REQUEST",
      retryable: false
    } as AdapterResult,
    decision: "needs_user",
    caseStatus: "needs_user",
    taskStatus: "failed"
  },
  {
    name: "nonretryable human failure",
    result: {
      status: "failed",
      failure_code: "UNKNOWN",
      retryable: false
    } as AdapterResult,
    decision: "needs_human",
    caseStatus: "needs_human",
    taskStatus: "failed"
  }
]) {
  test(`maps ${scenario.name} deterministically`, async () => {
    const state = fixture(scenario.result);
    const outcome = await state.executor.execute(command());
    assert.equal(outcome.decision, scenario.decision);
    assert.equal(state.database.cases[0]?.status, scenario.caseStatus);
    assert.equal(state.database.tasks[0]?.status, scenario.taskStatus);
  });
}

test("book success resumed from waiting external returns case to executing", async () => {
  const state = fixture(success("appointment_confirmation"), {
    caseStatus: "waiting_external",
    taskStatus: "waiting_external"
  });
  state.database.tasks[0]!.type = "book_appointment";
  const booking = command({
    type: "book_appointment",
    input: { ...command().input, slot_id: "slot-001" }
  });
  const outcome = await state.executor.execute(booking);
  assert.equal(outcome.decision, "completed");
  assert.equal(state.database.cases[0]?.status, "executing");
});

test("invalid or unverifiable evidence becomes human handoff without artifact", async () => {
  const state = fixture(success());
  state.adapter.evidence.clear();
  const outcome = await state.executor.execute(command());
  assert.deepEqual(outcome.result, {
    status: "needs_human",
    reason_code: "UNSUPPORTED_RESPONSE"
  });
  assert.equal(state.database.artifacts.length, 0);
  assert.equal(state.database.cases[0]?.status, "needs_human");
});

test("contract-invalid adapter result fails closed before persistence", async () => {
  const malformed = {
    status: "waiting_external",
    resume_after: "tomorrow",
    unexpected: true
  } as unknown as AdapterResult;
  const state = fixture(malformed);
  await assert.rejects(
    state.executor.execute(command()),
    (error: unknown) =>
      error instanceof TaskExecutorError && error.code === "INVALID_COMMAND"
  );
  assert.equal(state.database.attempts[0]?.status, "started");
  assert.equal(state.database.artifacts.length, 0);
});

test("terminal success with missing persisted evidence fails closed", async () => {
  const state = fixture();
  await state.executor.execute(command());
  state.database.artifacts.length = 0;
  await assert.rejects(
    state.executor.execute(command()),
    (error: unknown) =>
      error instanceof TaskExecutorError && error.code === "EVIDENCE_INVALID"
  );
  assert.equal(state.adapter.calls, 1);
});

test("serializable conflicts retry at most until claim succeeds", async () => {
  const state = fixture();
  state.database.serializationFailures = 2;
  const outcome = await state.executor.execute(command());
  assert.equal(outcome.decision, "completed");
  assert.equal(state.database.attempts.length, 1);
});

test("retries Prisma P2010 when PostgreSQL reports SQLSTATE 40001 in meta", async () => {
  const state = fixture();
  state.database.serializationFailures = 1;
  state.database.serializationFailure = {
    code: "P2010",
    meta: {
      code: "40001",
      message: "driver-specific text must not be parsed"
    }
  };

  const outcome = await state.executor.execute(command());

  assert.equal(outcome.decision, "completed");
  assert.equal(state.database.attempts.length, 1);
  assert.equal(state.adapter.calls, 1);
});

function seedAttempt(
  overrides: Partial<Attempt> = {}
): Attempt {
  return {
    id: "attempt-old",
    tenantId: "tenant-a",
    taskId: "task-001",
    sequence: 1,
    channel: "legacy-fingerprint",
    status: "failed",
    idempotencyKey: "idempotency-old1",
    correlationId: "correlation-old",
    startedAt: now,
    endedAt: now,
    failureCode: "UNKNOWN",
    retryable: false,
    externalReference: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}
