import { isRfc3339DateTime } from "./rfc3339.js";

export interface MedicalAppointmentCompletion {
  contract_id: "medical_appointment";
  contract_version: "1.0.0";
  tenant_id: string;
  case_id: string;
  attempt: {
    attempt_id: string;
    status: "succeeded";
    external_reference: string;
  };
  appointment: {
    provider_name: string;
    specialty: "pediatrics";
    starts_at: string;
    location_or_join_url: string;
    confirmation_reference: string;
  };
  artifact: {
    artifact_id: string;
    type: "appointment_confirmation";
    checksum: string;
    verification_status: "verified";
  };
  calendar:
    | {
        projection_count: 1;
        sync_status: "synced";
        external_event_id: string;
        failure_code?: string;
      }
    | {
        projection_count: 1;
        sync_status: "failed";
        failure_code: string;
        external_event_id?: string;
      };
}

export interface CompletionValidationResult {
  valid: boolean;
  errors: string[];
}

const NON_EMPTY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA_256 = /^sha256:[a-f0-9]{64}$/;

export function validateMedicalAppointmentCompletion(
  value: unknown
): CompletionValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ["completion must be an object"] };
  }

  exactKeys(value, [
    "contract_id",
    "contract_version",
    "tenant_id",
    "case_id",
    "attempt",
    "appointment",
    "artifact",
    "calendar"
  ], "completion", errors);
  constant(value.contract_id, "medical_appointment", "contract_id", errors);
  constant(value.contract_version, "1.0.0", "contract_version", errors);
  identifier(value.tenant_id, "tenant_id", errors);
  identifier(value.case_id, "case_id", errors);

  validateAttempt(value.attempt, errors);
  validateAppointment(value.appointment, errors);
  validateArtifact(value.artifact, errors);
  validateCalendar(value.calendar, errors);

  return { valid: errors.length === 0, errors };
}

export function isMedicalAppointmentCompletion(
  value: unknown
): value is MedicalAppointmentCompletion {
  return validateMedicalAppointmentCompletion(value).valid;
}

function validateAttempt(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("attempt must be an object");
    return;
  }
  exactKeys(value, ["attempt_id", "status", "external_reference"], "attempt", errors);
  identifier(value.attempt_id, "attempt.attempt_id", errors);
  constant(value.status, "succeeded", "attempt.status", errors);
  identifier(value.external_reference, "attempt.external_reference", errors);
}

function validateAppointment(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("appointment must be an object");
    return;
  }
  exactKeys(value, [
    "provider_name",
    "specialty",
    "starts_at",
    "location_or_join_url",
    "confirmation_reference"
  ], "appointment", errors);
  boundedString(value.provider_name, 1, 200, "appointment.provider_name", errors);
  constant(value.specialty, "pediatrics", "appointment.specialty", errors);
  if (
    typeof value.starts_at !== "string" ||
    !isRfc3339DateTime(value.starts_at)
  ) {
    errors.push("appointment.starts_at must be an RFC 3339 date-time");
  }
  boundedString(
    value.location_or_join_url,
    1,
    500,
    "appointment.location_or_join_url",
    errors
  );
  identifier(
    value.confirmation_reference,
    "appointment.confirmation_reference",
    errors
  );
}

function validateArtifact(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("artifact must be an object");
    return;
  }
  exactKeys(
    value,
    ["artifact_id", "type", "checksum", "verification_status"],
    "artifact",
    errors
  );
  identifier(value.artifact_id, "artifact.artifact_id", errors);
  constant(value.type, "appointment_confirmation", "artifact.type", errors);
  if (typeof value.checksum !== "string" || !SHA_256.test(value.checksum)) {
    errors.push("artifact.checksum must be a lowercase sha256 checksum");
  }
  constant(value.verification_status, "verified", "artifact.verification_status", errors);
}

function validateCalendar(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("calendar must be an object");
    return;
  }
  exactKeys(
    value,
    ["projection_count", "sync_status", "external_event_id", "failure_code"],
    "calendar",
    errors,
    ["projection_count", "sync_status"]
  );
  if (value.projection_count !== 1) {
    errors.push("calendar.projection_count must equal 1");
  }
  if (value.sync_status !== "synced" && value.sync_status !== "failed") {
    errors.push("calendar.sync_status must be synced or failed");
    return;
  }
  if (value.external_event_id !== undefined) {
    identifier(value.external_event_id, "calendar.external_event_id", errors);
  }
  if (value.failure_code !== undefined) {
    boundedString(value.failure_code, 3, 100, "calendar.failure_code", errors);
  }
  if (value.sync_status === "synced" && value.external_event_id === undefined) {
    errors.push("calendar.external_event_id is required when sync_status is synced");
  }
  if (value.sync_status === "failed" && value.failure_code === undefined) {
    errors.push("calendar.failure_code is required when sync_status is failed");
  }
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  errors: string[],
  required: string[] = allowed
): void {
  for (const key of required) {
    if (!(key in value)) errors.push(`${path}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function identifier(value: unknown, path: string, errors: string[]): void {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 200 ||
    !NON_EMPTY_ID.test(value)
  ) {
    errors.push(`${path} must be a valid non-empty identifier`);
  }
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
  errors: string[]
): void {
  const length = typeof value === "string" ? [...value].length : -1;
  if (length < minimum || length > maximum) {
    errors.push(`${path} must be a string between ${minimum} and ${maximum} characters`);
  }
}

function constant(
  value: unknown,
  expected: string,
  path: string,
  errors: string[]
): void {
  if (value !== expected) errors.push(`${path} must equal ${expected}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
