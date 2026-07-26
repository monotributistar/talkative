import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  ConsentManager,
  ConsentManagerError,
  type DecideMedicalAppointmentConsentInput,
  type MedicalAppointmentEffect
} from "./consent-manager.js";

type Row = Record<string, any>;

const now = new Date("2026-07-25T12:00:00.000Z");
const expiry = "2026-07-26T12:00:00.000Z";

class FakeConsentPrisma {
  readonly cases: Row[] = [];
  readonly subjects: Row[] = [];
  readonly delegations: Row[] = [];
  readonly consents: Row[] = [];
  readonly tasks: Row[] = [];
  consentWrites = 0;
  raceOnNextConsentCreate = false;

  case: any;
  subject: any;
  delegation: any;
  consent: any;
  task: any;

  constructor() {
    this.case = {
      findFirst: async ({ where }: Row) => this.find(this.cases, where)
    };
    this.subject = {
      findFirst: async ({ where }: Row) => this.find(this.subjects, where)
    };
    this.delegation = {
      findMany: async ({ where }: Row) => this.findMany(this.delegations, where)
    };
    this.task = {
      findFirst: async ({ where }: Row) => this.find(this.tasks, where)
    };
    this.consent = {
      create: async ({ data }: Row) => {
        const created = { ...data, revokedAt: null };
        this.consents.push(created);
        this.consentWrites += 1;
        if (this.raceOnNextConsentCreate) {
          this.raceOnNextConsentCreate = false;
          throw { code: "P2002" };
        }
        return { ...created };
      },
      findFirst: async ({ where }: Row) => this.find(this.consents, where),
      updateMany: async ({ where, data }: Row) => {
        const row = this.consents.find((candidate) => matches(candidate, where));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        this.consentWrites += 1;
        return { count: 1 };
      }
    };
  }

  asClient(): PrismaClient {
    return this as unknown as PrismaClient;
  }

  private find(rows: Row[], where: Row): Row | null {
    const row = rows.find((candidate) => matches(candidate, where));
    return row ? { ...row } : null;
  }

  private findMany(rows: Row[], where: Row): Row[] {
    return rows.filter((candidate) => matches(candidate, where)).map((row) => ({ ...row }));
  }
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function fixture(options: { caseStatus?: string; clock?: () => Date } = {}) {
  const database = new FakeConsentPrisma();
  database.cases.push({
    id: "case-001",
    tenantId: "tenant-a",
    principalId: "principal-001",
    subjectId: "subject-001",
    counterpartyId: "clinic-001",
    type: "medical_appointment",
    status: options.caseStatus ?? "ready_for_confirmation"
  });
  database.subjects.push({
    id: "subject-001",
    tenantId: "tenant-a",
    principalId: "principal-001",
    relationshipVerifiedAt: new Date("2026-07-24T12:00:00.000Z")
  });
  database.delegations.push({
    id: "delegation-001",
    tenantId: "tenant-a",
    principalId: "principal-001",
    subjectId: "subject-001",
    scope: ["coordinate_medical_appointment"],
    status: "active",
    validFrom: new Date("2026-07-24T12:00:00.000Z"),
    validUntil: new Date("2026-07-27T12:00:00.000Z")
  });
  database.tasks.push({
    id: "task-001",
    tenantId: "tenant-a",
    caseId: "case-001",
    type: "search_appointment"
  });
  const manager = new ConsentManager(database.asClient(), {
    clock: options.clock ?? (() => now),
    consentId: (tenantId, decisionId) => `consent:${tenantId}:${decisionId}`
  });
  return { database, manager };
}

function approval(
  overrides: Partial<DecideMedicalAppointmentConsentInput> = {}
): DecideMedicalAppointmentConsentInput {
  return {
    tenantId: "tenant-a",
    caseId: "case-001",
    principalId: "principal-001",
    decisionId: "decision-001",
    decision: "approved",
    draft: {
      purpose: "coordinate_medical_appointment",
      counterparty_id: "clinic-001",
      data_categories: ["subject_identity", "availability_preferences"],
      expires_at: expiry
    },
    version: "1.0.0",
    ...overrides
  };
}

function effect(overrides: Partial<MedicalAppointmentEffect> = {}): MedicalAppointmentEffect {
  return {
    tenantId: "tenant-a",
    caseId: "case-001",
    taskId: "task-001",
    type: "search_appointment",
    subjectId: "subject-001",
    counterpartyId: "clinic-001",
    consentId: "consent:tenant-a:decision-001",
    ...overrides
  };
}

function hasCode(code: ConsentManagerError["code"]) {
  return (error: unknown) =>
    error instanceof ConsentManagerError && error.code === code;
}

test("creates active consent only from an explicit valid approval", async () => {
  const { database, manager } = fixture();

  const consent = await manager.decideMedicalAppointmentConsent(approval());

  assert.ok("id" in consent);
  assert.equal(consent.id, "consent:tenant-a:decision-001");
  assert.equal(consent.status, "active");
  assert.equal(consent.grantedAt, now);
  assert.equal(consent.expiresAt?.toISOString(), expiry);
  assert.equal(database.consentWrites, 1);
  assert.equal(database.cases[0]?.status, "ready_for_confirmation");
});

test("rejecting a valid proposal creates no authority", async () => {
  const { database, manager } = fixture();

  const result = await manager.decideMedicalAppointmentConsent(
    approval({ decision: "rejected" })
  );

  assert.deepEqual(result, { decision: "rejected", consent: null });
  assert.equal(database.consents.length, 0);
});

test("exact replay wins after case advancement and compares categories as a set", async () => {
  const { database, manager } = fixture();
  const first = await manager.decideMedicalAppointmentConsent(approval());
  database.cases[0]!.status = "executing";

  const replay = await manager.decideMedicalAppointmentConsent(
    approval({
      draft: {
        ...approval().draft,
        data_categories: ["availability_preferences", "subject_identity"]
      }
    })
  );

  assert.ok("id" in first);
  assert.ok("id" in replay);
  assert.equal(replay.id, first.id);
  assert.equal(database.consents.length, 1);
  assert.equal(database.consentWrites, 1);
});

test("recovers an exact replay after a P2002 race", async () => {
  const { database, manager } = fixture();
  database.raceOnNextConsentCreate = true;

  const consent = await manager.decideMedicalAppointmentConsent(approval());

  assert.ok("id" in consent);
  assert.equal(consent.id, "consent:tenant-a:decision-001");
  assert.equal(database.consents.length, 1);
});

test("same decision with changed authority fails without another write", async () => {
  const { database, manager } = fixture();
  await manager.decideMedicalAppointmentConsent(approval());

  await assert.rejects(
    manager.decideMedicalAppointmentConsent(
      approval({
        draft: { ...approval().draft, counterparty_id: "clinic-002" }
      })
    ),
    hasCode("DECISION_CONFLICT")
  );
  assert.equal(database.consentWrites, 1);
});

test("expired or revoked replay cannot reactivate consent", async () => {
  const { database, manager } = fixture();
  await manager.decideMedicalAppointmentConsent(approval());
  database.consents[0]!.status = "revoked";
  database.consents[0]!.revokedAt = now;

  await assert.rejects(
    manager.decideMedicalAppointmentConsent(approval()),
    hasCode("NOT_AUTHORIZED")
  );
  assert.equal(database.consentWrites, 1);
});

test("new approval requires ready state, matching case recipient and current authority", async () => {
  const notReady = fixture({ caseStatus: "executing" });
  await assert.rejects(
    notReady.manager.decideMedicalAppointmentConsent(approval()),
    hasCode("NOT_AUTHORIZED")
  );

  const wrongRecipient = fixture();
  await assert.rejects(
    wrongRecipient.manager.decideMedicalAppointmentConsent(
      approval({
        draft: { ...approval().draft, counterparty_id: "clinic-002" }
      })
    ),
    hasCode("NOT_AUTHORIZED")
  );

  const futureRelationship = fixture();
  futureRelationship.database.subjects[0]!.relationshipVerifiedAt =
    new Date("2026-07-25T12:00:00.001Z");
  await assert.rejects(
    futureRelationship.manager.decideMedicalAppointmentConsent(approval()),
    hasCode("NOT_AUTHORIZED")
  );

  const expiredDelegation = fixture();
  expiredDelegation.database.delegations[0]!.validUntil = now;
  await assert.rejects(
    expiredDelegation.manager.decideMedicalAppointmentConsent(approval()),
    hasCode("NOT_AUTHORIZED")
  );
});

test("proposal validates decision, version, recipient, unique categories and future TTL", async () => {
  const invalidInputs: DecideMedicalAppointmentConsentInput[] = [
    approval({ decisionId: "x" }),
    approval({ version: "2.0.0" }),
    approval({ draft: { ...approval().draft, counterparty_id: "" } }),
    approval({
      draft: {
        ...approval().draft,
        data_categories: ["subject_identity", "subject_identity"]
      }
    }),
    approval({ draft: { ...approval().draft, expires_at: now.toISOString() } })
  ];

  for (const input of invalidInputs) {
    const { manager } = fixture();
    await assert.rejects(
      manager.decideMedicalAppointmentConsent(input),
      (error: unknown) =>
        error instanceof ConsentManagerError &&
        (error.code === "INVALID_DECISION" || error.code === "INVALID_PROPOSAL")
    );
  }
});

for (const [label, dateTime] of [
  ["short offset", "2026-07-26T15:00:00+03"],
  ["compact offset", "2026-07-26T15:00:00+0300"],
  ["colon offset", "2026-07-26T15:00:00+03:00"],
  ["space and lowercase zone", "2026-07-26 12:00:00z"]
] as const) {
  test(`accepts RFC 3339 ${label} and persists the equivalent instant`, async () => {
    const { manager } = fixture();
    const consent = await manager.decideMedicalAppointmentConsent(
      approval({
        draft: {
          ...approval().draft,
          expires_at: dateTime
        }
      })
    );

    assert.ok("expiresAt" in consent);
    assert.equal(consent.expiresAt?.toISOString(), expiry);
  });
}

test("accepts a valid RFC 3339 leap second and maps its instant", async () => {
  const { manager } = fixture();
  const consent = await manager.decideMedicalAppointmentConsent(
    approval({
      draft: {
        ...approval().draft,
        expires_at: "2026-12-31T23:59:60Z"
      }
    })
  );

  assert.ok("expiresAt" in consent);
  assert.equal(consent.expiresAt?.toISOString(), "2027-01-01T00:00:00.000Z");
});

test("rejects an invalid dependency-derived consent ID before persistence", async () => {
  const database = new FakeConsentPrisma();
  const base = fixture();
  database.cases.push(...base.database.cases);
  database.subjects.push(...base.database.subjects);
  database.delegations.push(...base.database.delegations);
  const manager = new ConsentManager(database.asClient(), {
    clock: () => now,
    consentId: () => `invalid/${"x".repeat(140)}`
  });

  await assert.rejects(
    manager.decideMedicalAppointmentConsent(approval()),
    hasCode("INVALID_DECISION")
  );
  assert.equal(database.consentWrites, 0);
});

test("authorizes exact consent, task, subject and recipient with sufficient categories", async () => {
  const { database, manager } = fixture();
  const consent = await manager.decideMedicalAppointmentConsent(approval());
  database.cases[0]!.status = "executing";

  const authorized = await manager.authorizeMedicalAppointmentEffect(effect());

  assert.ok("id" in consent);
  assert.equal(authorized.id, consent.id);
});

test("authorization denies scope expansion and mismatched task, subject or recipient", async () => {
  const variants: Partial<MedicalAppointmentEffect>[] = [
    { taskId: "task-other" },
    { type: "book_appointment" },
    { subjectId: "subject-other" },
    { counterpartyId: "clinic-other" }
  ];

  for (const variant of variants) {
    const { database, manager } = fixture();
    await manager.decideMedicalAppointmentConsent(approval());
    database.cases[0]!.status = "executing";
    await assert.rejects(
      manager.authorizeMedicalAppointmentEffect(effect(variant)),
      hasCode("NOT_AUTHORIZED")
    );
  }
});

test("authorization enforces effect minimums and rejects persisted unknown categories", async () => {
  const { database, manager } = fixture();
  await manager.decideMedicalAppointmentConsent(approval());
  database.cases[0]!.status = "executing";

  database.consents[0]!.dataCategories = ["coverage"];
  await assert.rejects(
    manager.authorizeMedicalAppointmentEffect(effect()),
    hasCode("NOT_AUTHORIZED")
  );

  database.consents[0]!.dataCategories = [
    "subject_identity",
    "availability_preferences",
    "clinical_notes"
  ];
  await assert.rejects(
    manager.authorizeMedicalAppointmentEffect(effect()),
    hasCode("NOT_AUTHORIZED")
  );
});

test("authorization revalidates expiry, relationship and delegation with injected clock", async () => {
  const scenarios = [
    (database: FakeConsentPrisma) => {
      database.consents[0]!.expiresAt = now;
    },
    (database: FakeConsentPrisma) => {
      database.subjects[0]!.relationshipVerifiedAt = null;
    },
    (database: FakeConsentPrisma) => {
      database.delegations[0]!.validUntil = now;
    }
  ];

  for (const mutate of scenarios) {
    const { database, manager } = fixture();
    await manager.decideMedicalAppointmentConsent(approval());
    database.cases[0]!.status = "waiting_external";
    mutate(database);
    await assert.rejects(
      manager.authorizeMedicalAppointmentEffect(effect()),
      hasCode("NOT_AUTHORIZED")
    );
  }
});

test("revocation is idempotent, uses injected clock once and blocks authorization", async () => {
  let clockCalls = 0;
  const revocationTime = new Date("2026-07-25T13:00:00.000Z");
  const { database, manager } = fixture({
    clock: () => {
      clockCalls += 1;
      return clockCalls === 1 ? now : revocationTime;
    }
  });
  await manager.decideMedicalAppointmentConsent(approval());
  database.cases[0]!.status = "executing";

  const input = {
    tenantId: "tenant-a",
    caseId: "case-001",
    principalId: "principal-001",
    consentId: "consent:tenant-a:decision-001"
  };
  const revoked = await manager.revokeConsent(input);
  const replay = await manager.revokeConsent(input);

  assert.equal(revoked.revokedAt, revocationTime);
  assert.equal(replay.revokedAt, revocationTime);
  assert.equal(database.consentWrites, 2);
  assert.equal(clockCalls, 2);
  await assert.rejects(
    manager.authorizeMedicalAppointmentEffect(effect()),
    hasCode("NOT_AUTHORIZED")
  );
});

test("cross-tenant decide, revoke and authorize are not found and never write", async () => {
  const { database, manager } = fixture();
  await manager.decideMedicalAppointmentConsent(approval());
  database.cases[0]!.status = "executing";
  const writes = database.consentWrites;

  await assert.rejects(
    manager.decideMedicalAppointmentConsent(
      approval({ tenantId: "tenant-b", decisionId: "decision-tenant-b" })
    ),
    hasCode("NOT_FOUND")
  );
  await assert.rejects(
    manager.revokeConsent({
      tenantId: "tenant-b",
      caseId: "case-001",
      principalId: "principal-001",
      consentId: "consent:tenant-a:decision-001"
    }),
    hasCode("NOT_FOUND")
  );
  await assert.rejects(
    manager.authorizeMedicalAppointmentEffect(
      effect({ tenantId: "tenant-b" })
    ),
    hasCode("NOT_FOUND")
  );
  assert.equal(database.consentWrites, writes);
});
