export interface TaskCommand {
  command_id: string;
  tenant_id: string;
  case_id: string;
  task_id: string;
  type: "search_appointment" | "book_appointment";
  input: {
    subject_id: string;
    specialty: "pediatrics";
    preferred_date_range: {
      from: string;
      to: string;
    };
    preferred_time_range: {
      from: string;
      to: string;
    };
    counterparty_id: string;
    slot_id?: string;
  };
  consent_id: string;
  idempotency_key: string;
  correlation_id: string;
}

export interface EvidenceReference {
  type: "availability_options" | "appointment_confirmation";
  reference: string;
  checksum: `sha256:${string}`;
}

export type AdapterResult =
  | {
      status: "succeeded";
      external_reference: string;
      evidence: EvidenceReference[];
    }
  | {
      status: "waiting_external";
      resume_after?: string;
      external_reference?: string;
    }
  | {
      status: "failed";
      failure_code:
        | "NO_AVAILABILITY"
        | "COUNTERPARTY_UNAVAILABLE"
        | "INVALID_REQUEST"
        | "CONSENT_INVALID"
        | "DUPLICATE_REQUEST"
        | "UNKNOWN";
      retryable: boolean;
    }
  | {
      status: "needs_user";
      missing_fields: Array<
        "subject" | "preferred_date_range" | "preferred_time_range" | "coverage" | "slot_id"
      >;
    }
  | {
      status: "needs_human";
      reason_code:
        | "ATTEMPTS_EXHAUSTED"
        | "POLICY_REQUIRES_HUMAN"
        | "COUNTERPARTY_REQUIRES_CALL"
        | "UNSUPPORTED_RESPONSE";
    };

export interface AppointmentAdapter {
  execute(command: TaskCommand): Promise<AdapterResult>;
}
