export type TurnDecisionField =
  | "subject"
  | "specialty"
  | "preferred_date_range"
  | "preferred_time_range"
  | "coverage";

export type DataCategory =
  | "subject_identity"
  | "coverage"
  | "availability_preferences";

export interface DateRange {
  from: string;
  to: string;
}

export interface TimeRange {
  from: string;
  to: string;
}

export interface CaseSummary {
  subject_id: string;
  specialty: "pediatrics";
  preferred_date_range: DateRange;
  preferred_time_range: TimeRange;
  counterparty_id?: string;
  data_to_share: DataCategory[];
}

export interface ConsentDraft {
  purpose: "coordinate_medical_appointment";
  counterparty_id: string;
  data_categories: DataCategory[];
  expires_at: string;
}

interface DecisionEnvelope {
  decision_id: string;
  case_id: string;
  correlation_id: string;
}

export type TurnDecision =
  | (DecisionEnvelope & {
      kind: "ask_field";
      field: TurnDecisionField;
      prompt: string;
    })
  | (DecisionEnvelope & {
      kind: "confirm_summary";
      summary: CaseSummary;
    })
  | (DecisionEnvelope & {
      kind: "request_consent";
      consent: ConsentDraft;
    })
  | (DecisionEnvelope & {
      kind: "propose_task";
      command_id: string;
    })
  | (DecisionEnvelope & {
      kind: "inform";
      message: string;
    })
  | (DecisionEnvelope & {
      kind: "handoff";
      reason_code:
        | "ATTEMPTS_EXHAUSTED"
        | "POLICY_REQUIRES_HUMAN"
        | "UNSUPPORTED_REQUEST"
        | "URGENT_OR_CLINICAL_REQUEST";
    });

export interface ConfirmedField<T> {
  value?: T;
  confirmed: boolean;
}

export interface RedactedCaseFields {
  subject: ConfirmedField<string>;
  specialty: ConfirmedField<"pediatrics">;
  preferred_date_range: ConfirmedField<DateRange>;
  preferred_time_range: ConfirmedField<TimeRange>;
  /**
   * Coverage is intentionally represented only by presence/confirmation. The
   * conversation engine does not need the provider or policy identifier.
   */
  coverage: ConfirmedField<"present" | "none">;
}

export type RequestClassification =
  | "administrative"
  | "unsupported"
  | "urgent_or_clinical";

export type ConsentState =
  | { status: "missing" }
  | { status: "rejected" }
  | { status: "revoked" }
  | {
      status: "active";
      counterparty_id: string;
      data_categories: DataCategory[];
      expires_at: string;
    };

export interface RedactedCaseState {
  case_id: string;
  correlation_id: string;
  counterparty_id: string;
  request_classification: RequestClassification;
  fields: RedactedCaseFields;
  summary_confirmed: boolean;
  consent: ConsentState;
  attempts_exhausted?: boolean;
}

export type TurnIdPurpose = "decision" | "command";

export interface TurnDecisionDependencies {
  clock: () => Date;
  createId: (purpose: TurnIdPurpose) => string;
  consentTtlMs?: number;
}
