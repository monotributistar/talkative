import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideNextTurn,
  InvalidTurnStateError,
} from "./turnEngine.js";
import type {
  RedactedCaseState,
  TurnDecisionDependencies,
} from "./types.js";

const NOW = new Date("2026-07-24T15:00:00.000Z");

interface ConversationFixture {
  name: string;
  scenario: "missing_time" | "missing_consent" | "urgent_or_clinical";
  expected_kind: string;
  expected_detail: string;
}

function dependencies(
  ids: Partial<Record<"decision" | "command", string>> = {},
): TurnDecisionDependencies {
  return {
    clock: () => new Date(NOW),
    createId: (purpose) =>
      ids[purpose] ??
      (purpose === "decision" ? "decision_generated" : "command_generated"),
  };
}

function readyState(
  overrides: Partial<RedactedCaseState> = {},
): RedactedCaseState {
  return {
    case_id: "case_001",
    correlation_id: "corr_001",
    counterparty_id: "clinic_01",
    request_classification: "administrative",
    fields: {
      subject: { value: "subject_01", confirmed: true },
      specialty: { value: "pediatrics", confirmed: true },
      preferred_date_range: {
        value: { from: "2026-07-27", to: "2026-07-31" },
        confirmed: true,
      },
      preferred_time_range: {
        value: { from: "14:00", to: "18:00" },
        confirmed: true,
      },
      coverage: { value: "none", confirmed: true },
    },
    summary_confirmed: true,
    consent: { status: "missing" },
    ...overrides,
  };
}

test("asks for preferred_time_range when that required field is missing", () => {
  const state = readyState({
    fields: {
      ...readyState().fields,
      preferred_time_range: { confirmed: false },
    },
  });

  assert.deepEqual(
    decideNextTurn(
      state,
      dependencies({ decision: "decision_001" }),
    ),
    {
      decision_id: "decision_001",
      case_id: "case_001",
      correlation_id: "corr_001",
      kind: "ask_field",
      field: "preferred_time_range",
      prompt: "¿En qué rango horario preferís el turno?",
    },
  );
});

test("requests scoped consent with an expiry derived from the injected clock", () => {
  assert.deepEqual(
    decideNextTurn(
      readyState(),
      dependencies({ decision: "decision_002" }),
    ),
    {
      decision_id: "decision_002",
      case_id: "case_001",
      correlation_id: "corr_001",
      kind: "request_consent",
      consent: {
        purpose: "coordinate_medical_appointment",
        counterparty_id: "clinic_01",
        data_categories: [
          "subject_identity",
          "availability_preferences",
        ],
        expires_at: "2026-07-25T15:00:00.000Z",
      },
    },
  );
});

test("hands off urgent or clinical requests before collecting fields", () => {
  const state = readyState({
    request_classification: "urgent_or_clinical",
    fields: {
      ...readyState().fields,
      preferred_time_range: { confirmed: false },
    },
  });

  assert.deepEqual(decideNextTurn(state, dependencies()), {
    decision_id: "decision_generated",
    case_id: "case_001",
    correlation_id: "corr_001",
    kind: "handoff",
    reason_code: "URGENT_OR_CLINICAL_REQUEST",
  });
});

test("summarizes confirmed fields before requesting consent", () => {
  const decision = decideNextTurn(
    readyState({
      summary_confirmed: false,
      fields: {
        ...readyState().fields,
        coverage: { value: "present", confirmed: true },
      },
    }),
    dependencies(),
  );

  assert.deepEqual(decision, {
    decision_id: "decision_generated",
    case_id: "case_001",
    correlation_id: "corr_001",
    kind: "confirm_summary",
    summary: {
      subject_id: "subject_01",
      specialty: "pediatrics",
      preferred_date_range: {
        from: "2026-07-27",
        to: "2026-07-31",
      },
      preferred_time_range: { from: "14:00", to: "18:00" },
      counterparty_id: "clinic_01",
      data_to_share: [
        "subject_identity",
        "coverage",
        "availability_preferences",
      ],
    },
  });
});

test("proposes one task when consent is active, scoped and unexpired", () => {
  const decision = decideNextTurn(
    readyState({
      consent: {
        status: "active",
        counterparty_id: "clinic_01",
        data_categories: [
          "subject_identity",
          "availability_preferences",
        ],
        expires_at: "2026-07-24T16:00:00.000Z",
      },
    }),
    dependencies({
      decision: "decision_ready",
      command: "command_ready",
    }),
  );

  assert.deepEqual(decision, {
    decision_id: "decision_ready",
    case_id: "case_001",
    correlation_id: "corr_001",
    kind: "propose_task",
    command_id: "command_ready",
  });
});

test("does not propose a task with expired or insufficient consent", () => {
  const expired = decideNextTurn(
    readyState({
      consent: {
        status: "active",
        counterparty_id: "clinic_01",
        data_categories: [
          "subject_identity",
          "availability_preferences",
        ],
        expires_at: "2026-07-24T15:00:00.000Z",
      },
    }),
    dependencies(),
  );
  assert.equal(expired.kind, "request_consent");

  const insufficient = decideNextTurn(
    readyState({
      fields: {
        ...readyState().fields,
        coverage: { value: "present", confirmed: true },
      },
      consent: {
        status: "active",
        counterparty_id: "clinic_01",
        data_categories: [
          "subject_identity",
          "availability_preferences",
        ],
        expires_at: "2026-07-24T16:00:00.000Z",
      },
    }),
    dependencies(),
  );
  assert.equal(insufficient.kind, "request_consent");
});

test("honors rejected consent without executing or immediately reprompting", () => {
  const decision = decideNextTurn(
    readyState({ consent: { status: "rejected" } }),
    dependencies(),
  );

  assert.equal(decision.kind, "inform");
  if (decision.kind === "inform") {
    assert.match(decision.message, /sin tu consentimiento/);
  }
});

test("rejects invalid input instead of emitting a contract-invalid decision", () => {
  assert.throws(
    () =>
      decideNextTurn(
        readyState({ case_id: "invalid id with spaces" }),
        dependencies(),
      ),
    InvalidTurnStateError,
  );
});

test("does not mutate the redacted case state", () => {
  const state = readyState();
  const snapshot = structuredClone(state);

  decideNextTurn(state, dependencies());

  assert.deepEqual(state, snapshot);
});

test("conversation fixtures produce the mandatory T005 decisions", () => {
  const fixtureUrl = new URL(
    "../../../specs/001-medical-appointment/fixtures/conversation-turn-cases.json",
    import.meta.url,
  );
  const fixtures = JSON.parse(
    readFileSync(fixtureUrl, "utf8"),
  ) as ConversationFixture[];

  for (const fixture of fixtures) {
    let state = readyState();
    if (fixture.scenario === "missing_time") {
      state = readyState({
        fields: {
          ...readyState().fields,
          preferred_time_range: { confirmed: false },
        },
      });
    } else if (fixture.scenario === "urgent_or_clinical") {
      state = readyState({
        request_classification: "urgent_or_clinical",
      });
    }

    const result = decideNextTurn(state, dependencies());
    assert.equal(result.kind, fixture.expected_kind, fixture.name);

    const detail =
      result.kind === "ask_field"
        ? result.field
        : result.kind === "request_consent"
          ? result.consent.purpose
          : result.kind === "handoff"
            ? result.reason_code
            : undefined;
    assert.equal(detail, fixture.expected_detail, fixture.name);
  }
});
