import type {
  CaseSummary,
  ConsentState,
  DataCategory,
  DateRange,
  RedactedCaseState,
  TimeRange,
  TurnDecision,
  TurnDecisionDependencies,
  TurnDecisionField,
} from "./types.js";

const DEFAULT_CONSENT_TTL_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const REQUIRED_FIELDS: readonly TurnDecisionField[] = [
  "subject",
  "specialty",
  "preferred_date_range",
  "preferred_time_range",
  "coverage",
];

const FIELD_PROMPTS: Readonly<Record<TurnDecisionField, string>> = {
  subject: "¿Para qué dependiente necesitás coordinar el turno?",
  specialty: "¿Confirmás que necesitás un turno de pediatría?",
  preferred_date_range: "¿Entre qué fechas preferís el turno?",
  preferred_time_range: "¿En qué rango horario preferís el turno?",
  coverage: "¿Querés usar una cobertura médica para este turno?",
};

type WithoutDecisionEnvelope<T> = T extends unknown
  ? Omit<T, "decision_id" | "case_id" | "correlation_id">
  : never;

type TurnDecisionBody = WithoutDecisionEnvelope<TurnDecision>;

export class InvalidTurnStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTurnStateError";
  }
}

/**
 * Pure decision function. It only proposes the next conversational step and
 * cannot persist, execute tools, approve consent, or mutate a Case.
 */
export function decideNextTurn(
  state: Readonly<RedactedCaseState>,
  dependencies: Readonly<TurnDecisionDependencies>,
): TurnDecision {
  validateEnvelope(state);
  const now = dependencies.clock();
  if (Number.isNaN(now.getTime())) {
    throw new InvalidTurnStateError("The injected clock returned an invalid date");
  }

  const decision = (body: TurnDecisionBody): TurnDecision =>
    ({
      decision_id: createContractId(dependencies, "decision"),
      case_id: state.case_id,
      correlation_id: state.correlation_id,
      ...body,
    }) as TurnDecision;

  if (state.request_classification === "urgent_or_clinical") {
    return decision({
      kind: "handoff",
      reason_code: "URGENT_OR_CLINICAL_REQUEST",
    });
  }

  if (state.request_classification === "unsupported") {
    return decision({
      kind: "handoff",
      reason_code: "UNSUPPORTED_REQUEST",
    });
  }

  if (state.attempts_exhausted === true) {
    return decision({
      kind: "handoff",
      reason_code: "ATTEMPTS_EXHAUSTED",
    });
  }

  const missingField = REQUIRED_FIELDS.find(
    (field) => !hasConfirmedValue(state, field),
  );
  if (missingField) {
    return decision({
      kind: "ask_field",
      field: missingField,
      prompt: FIELD_PROMPTS[missingField],
    });
  }

  const summary = buildSummary(state);
  if (!state.summary_confirmed) {
    return decision({ kind: "confirm_summary", summary });
  }

  if (state.consent.status === "rejected") {
    return decision({
      kind: "inform",
      message:
        "No contactaré a la clínica ni compartiré datos sin tu consentimiento.",
    });
  }

  const dataCategories = summary.data_to_share;
  if (
    !isConsentValid(
      state.consent,
      state.counterparty_id,
      dataCategories,
      now,
    )
  ) {
    const ttlMs = dependencies.consentTtlMs ?? DEFAULT_CONSENT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new InvalidTurnStateError("consentTtlMs must be a positive number");
    }

    return decision({
      kind: "request_consent",
      consent: {
        purpose: "coordinate_medical_appointment",
        counterparty_id: state.counterparty_id,
        data_categories: dataCategories,
        expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      },
    });
  }

  return decision({
    kind: "propose_task",
    command_id: createContractId(dependencies, "command"),
  });
}

function createContractId(
  dependencies: Readonly<TurnDecisionDependencies>,
  purpose: "decision" | "command",
): string {
  const id = dependencies.createId(purpose);
  assertContractId(id, `${purpose} id`);
  return id;
}

function validateEnvelope(state: Readonly<RedactedCaseState>): void {
  assertContractId(state.case_id, "case_id");
  assertContractId(state.correlation_id, "correlation_id");
  assertContractId(state.counterparty_id, "counterparty_id");
}

function assertContractId(value: string, label: string): void {
  if (
    value.length < 3 ||
    value.length > 128 ||
    !ID_PATTERN.test(value)
  ) {
    throw new InvalidTurnStateError(`${label} is not a valid contract id`);
  }
}

function hasConfirmedValue(
  state: Readonly<RedactedCaseState>,
  field: TurnDecisionField,
): boolean {
  const candidate = state.fields[field];
  if (!candidate.confirmed || candidate.value === undefined) {
    return false;
  }

  switch (field) {
    case "subject":
      return isContractId(candidate.value as string);
    case "specialty":
      return candidate.value === "pediatrics";
    case "preferred_date_range":
      return isValidDateRange(candidate.value as DateRange);
    case "preferred_time_range":
      return isValidTimeRange(candidate.value as TimeRange);
    case "coverage":
      return candidate.value === "present" || candidate.value === "none";
  }
}

function isContractId(value: string): boolean {
  return value.length >= 3 && value.length <= 128 && ID_PATTERN.test(value);
}

function isValidDateRange(range: DateRange): boolean {
  if (!DATE_PATTERN.test(range.from) || !DATE_PATTERN.test(range.to)) {
    return false;
  }

  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  return !Number.isNaN(from) && !Number.isNaN(to) && from <= to;
}

function isValidTimeRange(range: TimeRange): boolean {
  return (
    TIME_PATTERN.test(range.from) &&
    TIME_PATTERN.test(range.to) &&
    range.from < range.to
  );
}

function buildSummary(state: Readonly<RedactedCaseState>): CaseSummary {
  const subjectId = state.fields.subject.value;
  const specialty = state.fields.specialty.value;
  const dateRange = state.fields.preferred_date_range.value;
  const timeRange = state.fields.preferred_time_range.value;

  if (
    subjectId === undefined ||
    specialty === undefined ||
    dateRange === undefined ||
    timeRange === undefined
  ) {
    throw new InvalidTurnStateError(
      "Cannot build a summary from missing fields",
    );
  }

  return {
    subject_id: subjectId,
    specialty,
    preferred_date_range: { ...dateRange },
    preferred_time_range: { ...timeRange },
    counterparty_id: state.counterparty_id,
    data_to_share: requestedDataCategories(state),
  };
}

function requestedDataCategories(
  state: Readonly<RedactedCaseState>,
): DataCategory[] {
  const categories: DataCategory[] = [
    "subject_identity",
    "availability_preferences",
  ];
  if (state.fields.coverage.value === "present") {
    categories.splice(1, 0, "coverage");
  }
  return categories;
}

function isConsentValid(
  consent: ConsentState,
  counterpartyId: string,
  requiredCategories: readonly DataCategory[],
  now: Date,
): boolean {
  if (consent.status !== "active") {
    return false;
  }

  const expiry = Date.parse(consent.expires_at);
  if (Number.isNaN(expiry) || expiry <= now.getTime()) {
    return false;
  }

  if (consent.counterparty_id !== counterpartyId) {
    return false;
  }

  const authorized = new Set(consent.data_categories);
  return requiredCategories.every((category) => authorized.has(category));
}
