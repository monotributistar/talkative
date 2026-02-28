/**
 * Community Store tests
 *
 * Covers the critical path: ingest → getReports → buildDashboard → markReportsClassified
 * Plus urgency detection (isLikelyUrgent).
 *
 * Run:  pnpm test -- src/community/store.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  ingestReport,
  getReports,
  markReportsClassified,
  buildDashboard,
  isLikelyUrgent,
  setOnUrgentReport,
} from "./store.js";

let tmpWorkspace: string;

async function createTmpWorkspace(): Promise<string> {
  const dir = path.join(tmpdir(), `talkative-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "inputs"), { recursive: true });
  await fs.mkdir(path.join(dir, "outputs"), { recursive: true });
  await fs.mkdir(path.join(dir, "community"), { recursive: true });
  return dir;
}

async function cleanup(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

// ── isLikelyUrgent ─────────────────────────────────────────

describe("isLikelyUrgent", () => {
  it("detects fire keywords", () => {
    assert.equal(isLikelyUrgent("Hay fuego en el bosque"), true);
    assert.equal(isLikelyUrgent("Se siente olor a HUMO"), true);
    assert.equal(isLikelyUrgent("Veo llamas desde mi casa"), true);
  });

  it("detects robbery keywords", () => {
    assert.equal(isLikelyUrgent("Están robando en la casa de al lado"), true);
    assert.equal(isLikelyUrgent("Vi un asalto en la esquina"), true);
  });

  it("detects medical keywords", () => {
    assert.equal(isLikelyUrgent("Hay un herido en la ruta"), true);
    assert.equal(isLikelyUrgent("Necesitamos una ambulancia"), true);
  });

  it("returns false for non-urgent reports", () => {
    assert.equal(isLikelyUrgent("Hay un bache en la calle Junco"), false);
    assert.equal(isLikelyUrgent("Música fuerte hasta las 3am"), false);
    assert.equal(isLikelyUrgent("Consulta sobre poda de árboles"), false);
  });
});

// ── ingestReport ───────────────────────────────────────────

describe("ingestReport", () => {
  beforeEach(async () => {
    tmpWorkspace = await createTmpWorkspace();
  });

  afterEach(async () => {
    await cleanup(tmpWorkspace);
  });

  it("creates a report with generated id and pending status", async () => {
    const report = await ingestReport(tmpWorkspace, {
      resident_id: "vec-001",
      text: "Bache en la calle",
    });

    assert.ok(report.id.startsWith("report-"));
    assert.equal(report.status, "pending");
    assert.equal(report.resident_id, "vec-001");
    assert.equal(report.text, "Bache en la calle");
    assert.ok(report.timestamp);
  });

  it("appends to all-reports and pending-reports", async () => {
    await ingestReport(tmpWorkspace, { resident_id: "v1", text: "Report 1" });
    await ingestReport(tmpWorkspace, { resident_id: "v2", text: "Report 2" });

    const all = await getReports(tmpWorkspace, {});
    assert.equal(all.length, 2);

    const pending = await getReports(tmpWorkspace, { status: "pending" });
    assert.equal(pending.length, 2);
  });

  it("stores location and attachments", async () => {
    const report = await ingestReport(tmpWorkspace, {
      resident_id: "v1",
      text: "Algo pasa",
      location: { address_hint: "Cerezo y Divisadero" },
      attachments: [{ type: "image", url: "https://example.com/photo.jpg" }],
    });

    assert.equal(report.location?.address_hint, "Cerezo y Divisadero");
    assert.equal(report.attachments?.length, 1);
  });
});

// ── urgency auto-trigger ───────────────────────────────────

describe("urgency auto-trigger", () => {
  beforeEach(async () => {
    tmpWorkspace = await createTmpWorkspace();
  });

  afterEach(async () => {
    setOnUrgentReport(() => {}); // reset
    await cleanup(tmpWorkspace);
  });

  it("fires callback for urgent report", async () => {
    let triggered = false;
    let capturedDir = "";
    setOnUrgentReport((dir) => { triggered = true; capturedDir = dir; });

    await ingestReport(tmpWorkspace, {
      resident_id: "v1",
      text: "Hay FUEGO en el bosque cerca de la ruta",
    });

    assert.equal(triggered, true);
    assert.equal(capturedDir, tmpWorkspace);
  });

  it("does NOT fire callback for non-urgent report", async () => {
    let triggered = false;
    setOnUrgentReport(() => { triggered = true; });

    await ingestReport(tmpWorkspace, {
      resident_id: "v1",
      text: "Hay un bache grande en la calle",
    });

    assert.equal(triggered, false);
  });
});

// ── markReportsClassified ──────────────────────────────────

describe("markReportsClassified", () => {
  beforeEach(async () => {
    tmpWorkspace = await createTmpWorkspace();
  });

  afterEach(async () => {
    await cleanup(tmpWorkspace);
  });

  it("marks specific reports as classified and clears pending", async () => {
    const r1 = await ingestReport(tmpWorkspace, { resident_id: "v1", text: "Report 1" });
    const r2 = await ingestReport(tmpWorkspace, { resident_id: "v2", text: "Report 2" });
    await ingestReport(tmpWorkspace, { resident_id: "v3", text: "Report 3" });

    await markReportsClassified(tmpWorkspace, [r1.id, r2.id]);

    const all = await getReports(tmpWorkspace, {});
    const classified = all.filter((r) => r.status === "classified");
    const pending = all.filter((r) => r.status === "pending");

    assert.equal(classified.length, 2);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].text, "Report 3");

    // classified_at should be set
    assert.ok(classified[0].classified_at);
    assert.ok(classified[1].classified_at);
  });
});

// ── buildDashboard ─────────────────────────────────────────

describe("buildDashboard", () => {
  beforeEach(async () => {
    tmpWorkspace = await createTmpWorkspace();
  });

  afterEach(async () => {
    await cleanup(tmpWorkspace);
  });

  it("returns zero state when no reports exist", async () => {
    const dashboard = await buildDashboard(tmpWorkspace);

    assert.deepEqual(dashboard.totals, {});
    assert.deepEqual(dashboard.routing_summary, {});
    assert.deepEqual(dashboard.recent_items, []);
    assert.equal(dashboard.pending_count, 0);
    assert.equal(dashboard.last_classification_at, null);
  });

  it("counts pending reports correctly", async () => {
    await ingestReport(tmpWorkspace, { resident_id: "v1", text: "Report 1" });
    await ingestReport(tmpWorkspace, { resident_id: "v2", text: "Report 2" });

    const dashboard = await buildDashboard(tmpWorkspace);
    assert.equal(dashboard.pending_count, 2);
    assert.ok(dashboard.reports_today >= 2);
  });

  it("reads classification output when available", async () => {
    // Simulate a classification output file
    const classificationData = {
      ok: true,
      generatedAt: new Date().toISOString(),
      skillName: "community-classifier",
      data: {
        totals: { seguridad: 1, bomberos: 1 },
        items: [
          { report_id: "r-1", category: "seguridad", subcategory: "robo", urgency: 4, summary: "Test", location_normalized: null, confidence: 0.9, reasoning: "", routed_to: "empresa_seguridad" },
          { report_id: "r-2", category: "bomberos", subcategory: "humo", urgency: 5, summary: "Fire", location_normalized: "Ruta 11", confidence: 0.95, reasoning: "", routed_to: "bomberos" },
        ],
        routing_summary: {
          empresa_seguridad: { label: "Seguridad Privada", count: 1, highest_urgency: 4, notify: true },
          bomberos: { label: "Bomberos", count: 1, highest_urgency: 5, notify: true },
        },
      },
      metrics: { reportCount: 2, llmCalls: 1, totalTokensEstimate: 500, batchSize: 5, categoriesVersion: "1.0" },
    };

    await fs.writeFile(
      path.join(tmpWorkspace, "outputs", "classification-report.json"),
      JSON.stringify(classificationData, null, 2),
      "utf8"
    );

    const dashboard = await buildDashboard(tmpWorkspace);
    assert.deepEqual(dashboard.totals, { seguridad: 1, bomberos: 1 });
    assert.equal(dashboard.recent_items.length, 2);
    assert.ok(dashboard.last_classification_at);
    assert.equal(Object.keys(dashboard.routing_summary).length, 2);
  });
});

// ── getReports filters ─────────────────────────────────────

describe("getReports filters", () => {
  beforeEach(async () => {
    tmpWorkspace = await createTmpWorkspace();
  });

  afterEach(async () => {
    await cleanup(tmpWorkspace);
  });

  it("filters by status", async () => {
    const r1 = await ingestReport(tmpWorkspace, { resident_id: "v1", text: "A" });
    await ingestReport(tmpWorkspace, { resident_id: "v2", text: "B" });

    await markReportsClassified(tmpWorkspace, [r1.id]);

    const pending = await getReports(tmpWorkspace, { status: "pending" });
    const classified = await getReports(tmpWorkspace, { status: "classified" });

    assert.equal(pending.length, 1);
    assert.equal(classified.length, 1);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await ingestReport(tmpWorkspace, { resident_id: `v${i}`, text: `Report ${i}` });
    }

    const limited = await getReports(tmpWorkspace, { limit: 3 });
    assert.equal(limited.length, 3);
  });
});
