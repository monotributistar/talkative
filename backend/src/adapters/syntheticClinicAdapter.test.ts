import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SyntheticClinicAdapter,
  type SyntheticClinicSlot,
} from "./syntheticClinicAdapter.js";
import type { AdapterResult, TaskCommand } from "./types.js";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(
  THIS_DIR,
  "../../../specs/001-medical-appointment/fixtures"
);

async function readFixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(FIXTURES_DIR, name), "utf8")) as T;
}

async function setup(): Promise<{
  adapter: SyntheticClinicAdapter;
  commands: { search: TaskCommand; book: TaskCommand };
}> {
  const [slots, commands] = await Promise.all([
    readFixture<SyntheticClinicSlot[]>("clinic-slots.json"),
    readFixture<{ search: TaskCommand; book: TaskCommand }>("clinic-commands.json"),
  ]);

  return {
    adapter: new SyntheticClinicAdapter(slots),
    commands,
  };
}

function assertSucceeded(
  result: AdapterResult
): asserts result is Extract<AdapterResult, { status: "succeeded" }> {
  assert.equal(result.status, "succeeded");
}

test("search_appointment returns deterministic availability evidence", async () => {
  const { adapter, commands } = await setup();

  const first = await adapter.execute(commands.search);
  const second = await adapter.execute(commands.search);

  assertSucceeded(first);
  assert.deepEqual(second, first);
  assert.match(first.external_reference, /^search:[a-f0-9]{24}$/);
  assert.deepEqual(first.evidence.map((entry) => entry.type), [
    "availability_options",
  ]);

  const evidenceReference = first.evidence[0]!.reference;
  const evidence = adapter.getEvidence(evidenceReference);
  assert.equal(evidence?.type, "availability_options");
  if (evidence?.type === "availability_options") {
    assert.deepEqual(
      evidence.options.map((option) => option.slot_id),
      ["slot_001", "slot_002"]
    );
  }
  assert.equal(
    adapter.verifyEvidence(evidenceReference, first.evidence[0]!.checksum),
    true
  );
});

test("search_appointment returns a structured no-availability failure", async () => {
  const { adapter, commands } = await setup();
  const morningOnly: TaskCommand = {
    ...commands.search,
    idempotency_key: "case_001:search:unavailable:v1",
    input: {
      ...commands.search.input,
      preferred_date_range: {
        from: "2026-08-15",
        to: "2026-08-16",
      },
    },
  };

  const result = await adapter.execute(morningOnly);

  assert.deepEqual(result, {
    status: "failed",
    failure_code: "NO_AVAILABILITY",
    retryable: false,
  });
});

test("book_appointment is idempotent and creates one reservation", async () => {
  const { adapter, commands } = await setup();

  const first = await adapter.execute(commands.book);
  const second = await adapter.execute(commands.book);

  assertSucceeded(first);
  assert.deepEqual(second, first);
  assert.match(first.external_reference, /^booking:[a-f0-9]{24}$/);
  assert.equal(adapter.getReservationCount(), 1);
  assert.equal(first.evidence[0]?.type, "appointment_confirmation");
  assert.equal(
    adapter.verifyEvidence(
      first.evidence[0]!.reference,
      first.evidence[0]!.checksum
    ),
    true
  );
});

test("book_appointment rejects an occupied slot for another idempotency key", async () => {
  const { adapter, commands } = await setup();
  await adapter.execute(commands.book);

  const competingCommand: TaskCommand = {
    ...commands.book,
    command_id: "command_book_002",
    case_id: "case_002",
    task_id: "task_book_002",
    idempotency_key: "case_002:book:slot_001:v1",
    correlation_id: "corr_book_002",
  };
  const result = await adapter.execute(competingCommand);

  assert.deepEqual(result, {
    status: "failed",
    failure_code: "DUPLICATE_REQUEST",
    retryable: false,
  });
  assert.equal(adapter.getReservationCount(), 1);
});

test("reusing an idempotency key for a different command is rejected", async () => {
  const { adapter, commands } = await setup();
  await adapter.execute(commands.book);

  const conflictingCommand: TaskCommand = {
    ...commands.book,
    input: {
      ...commands.book.input,
      slot_id: "slot_002",
    },
  };
  const result = await adapter.execute(conflictingCommand);

  assert.deepEqual(result, {
    status: "failed",
    failure_code: "DUPLICATE_REQUEST",
    retryable: false,
  });
  assert.equal(adapter.getReservationCount(), 1);
});
