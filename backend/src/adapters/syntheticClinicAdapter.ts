import { createHash } from "node:crypto";
import type { AdapterResult, AppointmentAdapter, TaskCommand } from "./types.js";

export interface SyntheticClinicSlot {
  id: string;
  counterparty_id: string;
  specialty: "pediatrics";
  provider_id: string;
  local_date: string;
  local_start_time: string;
  starts_at: string;
  ends_at: string;
  location: string;
  available: boolean;
}

export interface AvailabilityEvidence {
  type: "availability_options";
  reference: string;
  counterparty_id: string;
  specialty: "pediatrics";
  options: Array<{
    slot_id: string;
    provider_id: string;
    starts_at: string;
    ends_at: string;
    location: string;
  }>;
}

export interface AppointmentConfirmationEvidence {
  type: "appointment_confirmation";
  reference: string;
  booking_reference: string;
  counterparty_id: string;
  slot_id: string;
  provider_id: string;
  specialty: "pediatrics";
  starts_at: string;
  ends_at: string;
  location: string;
}

export type SyntheticClinicEvidence =
  | AvailabilityEvidence
  | AppointmentConfirmationEvidence;

interface CachedExecution {
  fingerprint: string;
  result: AdapterResult;
}

interface Reservation {
  scopedIdempotencyKey: string;
  bookingReference: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }

  return value;
}

function serialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function digest(value: unknown): string {
  return createHash("sha256").update(serialize(value)).digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class SyntheticClinicAdapter implements AppointmentAdapter {
  private readonly slots: SyntheticClinicSlot[];
  private readonly executions = new Map<string, CachedExecution>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly evidence = new Map<string, SyntheticClinicEvidence>();

  constructor(slots: SyntheticClinicSlot[]) {
    this.slots = clone(slots);
  }

  async execute(command: TaskCommand): Promise<AdapterResult> {
    const scopedIdempotencyKey = `${command.tenant_id}:${command.idempotency_key}`;
    const fingerprint = digest({
      tenant_id: command.tenant_id,
      case_id: command.case_id,
      task_id: command.task_id,
      type: command.type,
      input: command.input,
      consent_id: command.consent_id,
    });
    const cached = this.executions.get(scopedIdempotencyKey);

    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        return {
          status: "failed",
          failure_code: "DUPLICATE_REQUEST",
          retryable: false,
        };
      }

      return clone(cached.result);
    }

    const result =
      command.type === "search_appointment"
        ? this.searchAppointments(command)
        : this.bookAppointment(command, scopedIdempotencyKey);

    this.executions.set(scopedIdempotencyKey, {
      fingerprint,
      result: clone(result),
    });

    return clone(result);
  }

  getEvidence(reference: string): SyntheticClinicEvidence | undefined {
    const value = this.evidence.get(reference);
    return value ? clone(value) : undefined;
  }

  getReservationCount(): number {
    return this.reservations.size;
  }

  verifyEvidence(reference: string, checksum: string): boolean {
    const value = this.evidence.get(reference);
    return value !== undefined && checksum === `sha256:${digest(value)}`;
  }

  private searchAppointments(command: TaskCommand): AdapterResult {
    const options = this.slots
      .filter(
        (slot) =>
          slot.available &&
          !this.reservations.has(slot.id) &&
          slot.counterparty_id === command.input.counterparty_id &&
          slot.specialty === command.input.specialty &&
          slot.local_date >= command.input.preferred_date_range.from &&
          slot.local_date <= command.input.preferred_date_range.to &&
          slot.local_start_time >= command.input.preferred_time_range.from &&
          slot.local_start_time <= command.input.preferred_time_range.to
      )
      .sort(
        (left, right) =>
          left.starts_at.localeCompare(right.starts_at) || left.id.localeCompare(right.id)
      )
      .map((slot) => ({
        slot_id: slot.id,
        provider_id: slot.provider_id,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        location: slot.location,
      }));

    if (options.length === 0) {
      return {
        status: "failed",
        failure_code: "NO_AVAILABILITY",
        retryable: false,
      };
    }

    const searchDigest = digest({
      tenant_id: command.tenant_id,
      case_id: command.case_id,
      counterparty_id: command.input.counterparty_id,
      options,
    });
    const externalReference = `search:${searchDigest.slice(0, 24)}`;
    const evidenceReference = `availability:${searchDigest.slice(0, 24)}`;
    const evidence: AvailabilityEvidence = {
      type: "availability_options",
      reference: evidenceReference,
      counterparty_id: command.input.counterparty_id,
      specialty: command.input.specialty,
      options,
    };
    this.evidence.set(evidenceReference, evidence);

    return {
      status: "succeeded",
      external_reference: externalReference,
      evidence: [
        {
          type: "availability_options",
          reference: evidenceReference,
          checksum: `sha256:${digest(evidence)}`,
        },
      ],
    };
  }

  private bookAppointment(
    command: TaskCommand,
    scopedIdempotencyKey: string
  ): AdapterResult {
    const slotId = command.input.slot_id;

    if (!slotId) {
      return {
        status: "needs_user",
        missing_fields: ["slot_id"],
      };
    }

    const slot = this.slots.find((candidate) => candidate.id === slotId);
    if (
      !slot ||
      !slot.available ||
      slot.counterparty_id !== command.input.counterparty_id ||
      slot.specialty !== command.input.specialty
    ) {
      return {
        status: "failed",
        failure_code: "INVALID_REQUEST",
        retryable: false,
      };
    }

    if (this.reservations.has(slot.id)) {
      return {
        status: "failed",
        failure_code: "DUPLICATE_REQUEST",
        retryable: false,
      };
    }

    const bookingDigest = digest({
      tenant_id: command.tenant_id,
      case_id: command.case_id,
      slot_id: slot.id,
      idempotency_key: command.idempotency_key,
    });
    const bookingReference = `booking:${bookingDigest.slice(0, 24)}`;
    const evidenceReference = `confirmation:${bookingDigest.slice(0, 24)}`;
    const evidence: AppointmentConfirmationEvidence = {
      type: "appointment_confirmation",
      reference: evidenceReference,
      booking_reference: bookingReference,
      counterparty_id: slot.counterparty_id,
      slot_id: slot.id,
      provider_id: slot.provider_id,
      specialty: slot.specialty,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      location: slot.location,
    };

    this.reservations.set(slot.id, {
      scopedIdempotencyKey,
      bookingReference,
    });
    this.evidence.set(evidenceReference, evidence);

    return {
      status: "succeeded",
      external_reference: bookingReference,
      evidence: [
        {
          type: "appointment_confirmation",
          reference: evidenceReference,
          checksum: `sha256:${digest(evidence)}`,
        },
      ],
    };
  }
}
