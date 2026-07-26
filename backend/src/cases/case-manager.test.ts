import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  CaseManager,
  CaseManagerError,
  type CompleteMedicalAppointmentInput
} from "./case-manager.js";
import type { MedicalAppointmentCompletion } from "./completion-validator.js";

const originalTime = new Date("2026-07-24T12:00:00.000Z");
const transitionTime = new Date("2026-07-24T15:00:00.000Z");
const appointmentTime = new Date("2026-07-30T18:00:00.000Z");
const checksum = `sha256:${"a".repeat(64)}`;

type CaseRow = {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  updatedAt: Date;
  completedAt: Date | null;
};

class FakeManagerPrisma {
  readonly cases: CaseRow[] = [];
  readonly tasks: Array<{ id: string; tenantId: string; caseId: string; type: string }> = [];
  readonly attempts: Array<{
    id: string;
    tenantId: string;
    taskId: string;
    status: string;
    externalReference: string | null;
  }> = [];
  readonly artifacts: Array<{
    id: string;
    tenantId: string;
    caseId: string;
    type: string;
    verificationStatus: string;
    checksum: string;
  }> = [];
  readonly projections: Array<{
    tenantId: string;
    caseId: string;
    startsAt: Date;
    syncStatus: string;
    externalEventId: string | null;
    failureCode: string | null;
  }> = [];

  updateCount = 0;
  beforeCaseUpdate?: () => void;

  case: any;
  attempt: any;
  artifact: any;
  calendarProjection: any;

  constructor() {
    this.case = {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const found = this.cases.find(
          (row) => row.tenantId === where.tenantId && row.id === where.id
        );
        return found ? { ...found } : null;
      },
      updateMany: async ({
        where,
        data
      }: {
        where: Record<string, unknown>;
        data: Partial<CaseRow>;
      }) => {
        this.beforeCaseUpdate?.();
        const found = this.cases.find(
          (row) =>
            row.tenantId === where.tenantId &&
            row.id === where.id &&
            row.status === where.status
        );
        if (!found) return { count: 0 };
        Object.assign(found, data);
        this.updateCount += 1;
        return { count: 1 };
      }
    };
    this.attempt = {
      findFirst: async ({ where }: { where: Record<string, any> }) => {
        const found = this.attempts.find((row) => {
          const task = this.tasks.find((candidate) => candidate.id === row.taskId);
          return (
            row.tenantId === where.tenantId &&
            row.id === where.id &&
            row.status === where.status &&
            row.externalReference === where.externalReference &&
            task?.tenantId === where.task.tenantId &&
            task?.caseId === where.task.caseId &&
            task?.type === where.task.type
          );
        });
        return found
          ? { id: found.id, externalReference: found.externalReference }
          : null;
      }
    };
    this.artifact = {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const found = this.artifacts.find((row) =>
          Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value)
        );
        return found ? { id: found.id } : null;
      }
    };
    this.calendarProjection = {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        this.projections
          .filter((row) => row.tenantId === where.tenantId && row.caseId === where.caseId)
          .map((row) => ({ ...row }))
    };
  }

  asClient(): PrismaClient {
    return this as unknown as PrismaClient;
  }
}

function validCompletion(): MedicalAppointmentCompletion {
  return {
    contract_id: "medical_appointment",
    contract_version: "1.0.0",
    tenant_id: "tenant-a",
    case_id: "case-001",
    attempt: {
      attempt_id: "attempt-001",
      status: "succeeded",
      external_reference: "booking-001"
    },
    appointment: {
      provider_name: "Synthetic Pediatrics",
      specialty: "pediatrics",
      starts_at: appointmentTime.toISOString(),
      location_or_join_url: "Synthetic clinic room 1",
      confirmation_reference: "booking-001"
    },
    artifact: {
      artifact_id: "artifact-001",
      type: "appointment_confirmation",
      checksum,
      verification_status: "verified"
    },
    calendar: {
      projection_count: 1,
      sync_status: "synced",
      external_event_id: "event-001"
    }
  };
}

function createFixture(status = "draft") {
  const database = new FakeManagerPrisma();
  database.cases.push({
    id: "case-001",
    tenantId: "tenant-a",
    type: "medical_appointment",
    status,
    updatedAt: originalTime,
    completedAt: null
  });
  const manager = new CaseManager(database.asClient(), {
    clock: () => transitionTime
  });
  return { database, manager };
}

function seedCompletionEvidence(database: FakeManagerPrisma): void {
  database.tasks.push({
    id: "task-001",
    tenantId: "tenant-a",
    caseId: "case-001",
    type: "book_appointment"
  });
  database.attempts.push({
    id: "attempt-001",
    tenantId: "tenant-a",
    taskId: "task-001",
    status: "succeeded",
    externalReference: "booking-001"
  });
  database.artifacts.push({
    id: "artifact-001",
    tenantId: "tenant-a",
    caseId: "case-001",
    type: "appointment_confirmation",
    verificationStatus: "verified",
    checksum
  });
  database.projections.push({
    tenantId: "tenant-a",
    caseId: "case-001",
    startsAt: appointmentTime,
    syncStatus: "synced",
    externalEventId: "event-001",
    failureCode: null
  });
}

test("applies a valid transition once with the injected clock", async () => {
  const { database, manager } = createFixture();

  const result = await manager.transition({
    tenantId: "tenant-a",
    caseId: "case-001",
    fromStatus: "draft",
    toStatus: "collecting_information"
  });

  assert.equal(result.status, "collecting_information");
  assert.equal(result.updatedAt, transitionTime);
  assert.equal(database.updateCount, 1);
});

test("rejects invalid transitions and every generic transition to completed", async () => {
  const { database, manager } = createFixture();

  for (const toStatus of ["executing", "completed"] as const) {
    await assert.rejects(
      manager.transition({
        tenantId: "tenant-a",
        caseId: "case-001",
        fromStatus: "draft",
        toStatus
      }),
      hasCode("INVALID_TRANSITION")
    );
  }
  assert.equal(database.cases[0]?.status, "draft");
  assert.equal(database.updateCount, 0);

  database.cases[0]!.status = "completed";
  await assert.rejects(
    manager.transition({
      tenantId: "tenant-a",
      caseId: "case-001",
      fromStatus: "completed",
      toStatus: "completed"
    }),
    hasCode("INVALID_TRANSITION")
  );
});

test("repeating a non-completed current state is idempotent and does not write", async () => {
  const { database, manager } = createFixture("cancelled");

  const result = await manager.transition({
    tenantId: "tenant-a",
    caseId: "case-001",
    fromStatus: "cancelled",
    toStatus: "cancelled"
  });

  assert.equal(result.status, "cancelled");
  assert.equal(database.updateCount, 0);
});

test("does not leak a case across tenant boundaries", async () => {
  const { database, manager } = createFixture();

  await assert.rejects(
    manager.transition({
      tenantId: "tenant-b",
      caseId: "case-001",
      fromStatus: "draft",
      toStatus: "collecting_information"
    }),
    hasCode("CASE_NOT_FOUND")
  );
  assert.equal(database.updateCount, 0);
});

test("rejects stale state and a compare-and-set race without overwriting", async () => {
  const stale = createFixture("collecting_information");
  await assert.rejects(
    stale.manager.transition({
      tenantId: "tenant-a",
      caseId: "case-001",
      fromStatus: "draft",
      toStatus: "collecting_information"
    }),
    hasCode("CONCURRENT_UPDATE")
  );

  const raced = createFixture();
  raced.database.beforeCaseUpdate = () => {
    raced.database.cases[0]!.status = "cancelled";
    raced.database.beforeCaseUpdate = undefined;
  };
  await assert.rejects(
    raced.manager.transition({
      tenantId: "tenant-a",
      caseId: "case-001",
      fromStatus: "draft",
      toStatus: "collecting_information"
    }),
    hasCode("CONCURRENT_UPDATE")
  );
  assert.equal(raced.database.cases[0]?.status, "cancelled");
  assert.equal(raced.database.updateCount, 0);
});

test("completes from executing only after persisted evidence matches", async () => {
  const { database, manager } = createFixture("executing");
  seedCompletionEvidence(database);

  const result = await manager.completeMedicalAppointment({
    tenantId: "tenant-a",
    caseId: "case-001",
    fromStatus: "executing",
    completion: validCompletion()
  });

  assert.equal(result.status, "completed");
  assert.equal(result.completedAt, transitionTime);
  assert.equal(database.cases[0]?.completedAt, transitionTime);
  assert.equal(database.updateCount, 1);
});

test("matches a space-separated short-offset appointment to its persisted instant", async () => {
  const { database, manager } = createFixture("executing");
  seedCompletionEvidence(database);
  const completion = validCompletion();
  completion.appointment.starts_at = "2026-07-30 21:00:00+03";

  const result = await manager.completeMedicalAppointment({
    tenantId: "tenant-a",
    caseId: "case-001",
    fromStatus: "executing",
    completion
  });

  assert.equal(result.status, "completed");
  assert.equal(database.updateCount, 1);
});

test("maps a valid leap-second appointment to the following persisted instant", async () => {
  const { database, manager } = createFixture("executing");
  seedCompletionEvidence(database);
  database.projections[0]!.startsAt = new Date("2027-01-01T00:00:00.000Z");
  const completion = validCompletion();
  completion.appointment.starts_at = "2026-12-31T23:59:60Z";

  const result = await manager.completeMedicalAppointment({
    tenantId: "tenant-a",
    caseId: "case-001",
    fromStatus: "executing",
    completion
  });

  assert.equal(result.status, "completed");
  assert.equal(database.updateCount, 1);
});

test("replaying valid completion is idempotent without a second write", async () => {
  const { database, manager } = createFixture("executing");
  seedCompletionEvidence(database);
  const input: CompleteMedicalAppointmentInput = {
    tenantId: "tenant-a",
    caseId: "case-001",
    fromStatus: "executing",
    completion: validCompletion()
  };

  const first = await manager.completeMedicalAppointment(input);
  const replay = await manager.completeMedicalAppointment(input);

  assert.equal(first.completedAt, transitionTime);
  assert.equal(replay.status, "completed");
  assert.equal(replay.completedAt, transitionTime);
  assert.equal(database.updateCount, 1);
});

test("rejects structurally invalid evidence without writing", async () => {
  const { database, manager } = createFixture("executing");
  seedCompletionEvidence(database);
  const completion = {
    ...validCompletion(),
    unexpected_personal_data: "not allowed"
  };

  await assert.rejects(
    manager.completeMedicalAppointment({
      tenantId: "tenant-a",
      caseId: "case-001",
      fromStatus: "executing",
      completion
    }),
    hasCode("INVALID_EVIDENCE")
  );
  assert.equal(database.cases[0]?.status, "executing");
  assert.equal(database.updateCount, 0);
});

test("rejects valid-shaped evidence that disagrees with persisted records", async () => {
  const variants: Array<(database: FakeManagerPrisma, completion: MedicalAppointmentCompletion) => void> = [
    (_database, completion) => {
      completion.attempt.external_reference = "booking-other";
      completion.appointment.confirmation_reference = "booking-other";
    },
    (database) => {
      database.artifacts[0]!.caseId = "case-other";
    },
    (database) => {
      database.artifacts[0]!.tenantId = "tenant-b";
    },
    (database) => {
      database.tasks[0]!.type = "search_appointment";
    },
    (database) => {
      database.projections.push({ ...database.projections[0]! });
    },
    (_database, completion) => {
      completion.calendar = {
        projection_count: 1,
        sync_status: "synced",
        external_event_id: "event-other"
      };
    }
  ];

  for (const mutate of variants) {
    const { database, manager } = createFixture("executing");
    seedCompletionEvidence(database);
    const completion = validCompletion();
    mutate(database, completion);
    await assert.rejects(
      manager.completeMedicalAppointment({
        tenantId: "tenant-a",
        caseId: "case-001",
        fromStatus: "executing",
        completion
      }),
      hasCode("INVALID_EVIDENCE")
    );
    assert.equal(database.cases[0]?.status, "executing");
    assert.equal(database.updateCount, 0);
  }
});

test("rejects evidence identifiers for another tenant or case", async () => {
  const { database, manager } = createFixture("executing");
  seedCompletionEvidence(database);

  for (const completion of [
    { ...validCompletion(), tenant_id: "tenant-b" },
    { ...validCompletion(), case_id: "case-other" }
  ]) {
    await assert.rejects(
      manager.completeMedicalAppointment({
        tenantId: "tenant-a",
        caseId: "case-001",
        fromStatus: "executing",
        completion
      }),
      hasCode("INVALID_EVIDENCE")
    );
  }
  assert.equal(database.updateCount, 0);
});

test("rejects completion from a non-completable state", async () => {
  const { database, manager } = createFixture("draft");
  seedCompletionEvidence(database);

  await assert.rejects(
    manager.completeMedicalAppointment({
      tenantId: "tenant-a",
      caseId: "case-001",
      fromStatus: "executing",
      completion: validCompletion()
    }),
    hasCode("INVALID_TRANSITION")
  );
  assert.equal(database.cases[0]?.status, "draft");
  assert.equal(database.updateCount, 0);
});

test("completion uses compare-and-set and preserves a concurrent state change", async () => {
  const { database, manager } = createFixture("executing");
  seedCompletionEvidence(database);
  database.beforeCaseUpdate = () => {
    database.cases[0]!.status = "needs_human";
    database.beforeCaseUpdate = undefined;
  };

  await assert.rejects(
    manager.completeMedicalAppointment({
      tenantId: "tenant-a",
      caseId: "case-001",
      fromStatus: "executing",
      completion: validCompletion()
    }),
    hasCode("CONCURRENT_UPDATE")
  );
  assert.equal(database.cases[0]?.status, "needs_human");
  assert.equal(database.cases[0]?.completedAt, null);
  assert.equal(database.updateCount, 0);
});

test("accepts a persisted failed calendar projection without invalidating booking", async () => {
  const { database, manager } = createFixture("waiting_external");
  seedCompletionEvidence(database);
  database.projections[0]!.syncStatus = "failed";
  database.projections[0]!.externalEventId = null;
  database.projections[0]!.failureCode = "calendar_unavailable";
  const completion = validCompletion();
  completion.calendar = {
    projection_count: 1,
    sync_status: "failed",
    failure_code: "calendar_unavailable"
  };

  const result = await manager.completeMedicalAppointment({
    tenantId: "tenant-a",
    caseId: "case-001",
    fromStatus: "waiting_external",
    completion
  });

  assert.equal(result.status, "completed");
  assert.equal(database.updateCount, 1);
});

function hasCode(code: string) {
  return (error: unknown) =>
    error instanceof CaseManagerError && error.code === code;
}
