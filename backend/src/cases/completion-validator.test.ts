import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateMedicalAppointmentCompletion } from "./completion-validator.js";

interface ContractFixture {
  name: string;
  value: unknown;
}

function readFixtures(kind: "valid" | "invalid"): ContractFixture[] {
  const fixturePath = fileURLToPath(
    new URL(
      `../../../specs/001-medical-appointment/fixtures/medical-appointment-completion.${kind}.json`,
      import.meta.url
    )
  );
  return JSON.parse(readFileSync(fixturePath, "utf8")) as ContractFixture[];
}

test("code-native validator accepts every frozen valid completion fixture", () => {
  for (const fixture of readFixtures("valid")) {
    const result = validateMedicalAppointmentCompletion(fixture.value);
    assert.equal(
      result.valid,
      true,
      `${fixture.name} should be valid: ${result.errors.join(", ")}`
    );
  }
});

test("code-native validator rejects every frozen invalid completion fixture", () => {
  for (const fixture of readFixtures("invalid")) {
    const result = validateMedicalAppointmentCompletion(fixture.value);
    assert.equal(result.valid, false, `${fixture.name} should be invalid`);
  }
});

test("calendar permits known fields from the opposite conditional branch", () => {
  const [syncedFixture, failedFixture] = readFixtures("valid");
  assert.ok(syncedFixture);
  assert.ok(failedFixture);

  const synced = structuredClone(syncedFixture.value) as {
    calendar: Record<string, unknown>;
  };
  synced.calendar.failure_code = "PREVIOUS_FAILURE";
  assert.equal(validateMedicalAppointmentCompletion(synced).valid, true);

  const failed = structuredClone(failedFixture.value) as {
    calendar: Record<string, unknown>;
  };
  failed.calendar.external_event_id = "stale_event_001";
  assert.equal(validateMedicalAppointmentCompletion(failed).valid, true);
});

test("date-time validation matches AJV for calendar dates, lowercase markers and leap seconds", () => {
  const [fixture] = readFixtures("valid");
  assert.ok(fixture);

  const withStartsAt = (startsAt: string) => {
    const completion = structuredClone(fixture.value) as {
      appointment: { starts_at: string };
    };
    completion.appointment.starts_at = startsAt;
    return validateMedicalAppointmentCompletion(completion).valid;
  };

  assert.equal(withStartsAt("2026-02-31T10:00:00Z"), false);
  assert.equal(withStartsAt("2026-08-12t15:30:00z"), true);
  assert.equal(withStartsAt("2026-08-12 15:30:00Z"), true);
  assert.equal(withStartsAt("2026-08-12T15:30:00+03"), true);
  assert.equal(withStartsAt("2026-08-12T15:30:00+0330"), true);
  assert.equal(withStartsAt("2026-08-12T15:30:00+03:30"), true);
  assert.equal(withStartsAt("2026-12-31T23:59:60Z"), true);
  assert.equal(withStartsAt("2026-08-12T15:30:60+00:00"), false);
});

test("bounded strings count Unicode code points like JSON Schema", () => {
  const [fixture] = readFixtures("valid");
  assert.ok(fixture);
  const completion = structuredClone(fixture.value) as {
    appointment: {
      provider_name: string;
      location_or_join_url: string;
    };
  };
  completion.appointment.provider_name = "😀".repeat(150);
  completion.appointment.location_or_join_url = "🧭".repeat(400);

  assert.equal(validateMedicalAppointmentCompletion(completion).valid, true);
});
