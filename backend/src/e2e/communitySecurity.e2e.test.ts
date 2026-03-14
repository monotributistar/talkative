import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";

const tempRoot = await mkdtemp(path.join(tmpdir(), "talkative-community-e2e-"));
const dataRoot = path.join(tempRoot, "data-root");
const dbPath = path.join(tempRoot, "community.db");

process.env.TALKATIVE_DATA_ROOT = dataRoot;
process.env.COMMUNITY_DB_PATH = dbPath;
process.env.COMMUNITY_CODE_MAP = "tenant-a:codeA,tenant-b:codeB";
process.env.OPERATOR_PASSWORD = "operator-password-strong";
process.env.AUTH_DISABLED = "true";

const { requireCommunityCode } = await import("../community/auth.js");
const { ingestReport, getReportById } = await import("../community/storeSqlite.js");
const { savePhoto, getPhotoBuffer, getPhotosForReport } = await import("../community/photoStorage.js");
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

test.after(async () => {
  delete process.env.TALKATIVE_DATA_ROOT;
  delete process.env.COMMUNITY_DB_PATH;
  delete process.env.COMMUNITY_CODE_MAP;
  delete process.env.OPERATOR_PASSWORD;
  delete process.env.AUTH_DISABLED;
  await rm(tempRoot, { recursive: true, force: true });
});

function runCommunityAuth(req: Partial<Request>): { ok: boolean; status?: number; body?: unknown; tenant_id?: string } {
  let statusCode: number | undefined;
  let payload: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    },
  } as Partial<Response>;

  let passed = false;
  const next: NextFunction = () => {
    passed = true;
  };

  requireCommunityCode(req as Request, res as Response, next);
  return {
    ok: passed,
    status: statusCode,
    body: payload,
    tenant_id: (req as Request).community_tenant_id,
  };
}

test("community auth rejects missing/invalid code", () => {
  const missing = runCommunityAuth({ headers: {}, body: {}, query: {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 401);

  const invalid = runCommunityAuth({
    headers: { "x-community-code": "wrong" } as Request["headers"],
    body: {},
    query: {},
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 401);
});

test("community tenant is derived from code, not spoofable header", () => {
  const req = {
    headers: {
      "x-community-code": "codeA",
      "x-tenant-id": "tenant-b",
    } as Request["headers"],
    body: {},
    query: {},
  } as Partial<Request>;

  const auth = runCommunityAuth(req);
  assert.equal(auth.ok, true);
  assert.equal(auth.tenant_id, "tenant-a");

  const created = ingestReport(auth.tenant_id!, {
    resident_id: "res-01",
    text: "Luces apagadas en calle principal",
  });

  assert.ok(getReportById("tenant-a", created.id));
  assert.equal(getReportById("tenant-b", created.id), null);
});

test("community photo access is tenant-scoped", async () => {
  const report = ingestReport("tenant-a", {
    resident_id: "res-photo",
    text: "Foto de incidente",
  });

  const photo = await savePhoto(report.id, {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    originalname: "incident.jpg",
    mimetype: "image/jpeg",
    size: 4,
  });

  assert.ok(photo.id);
  const allowed = await getPhotoBuffer(photo.id, "tenant-a");
  assert.ok(allowed);

  const denied = await getPhotoBuffer(photo.id, "tenant-b");
  assert.equal(denied, null);
});

test("community status payload matches snapshot contract", async () => {
  const report = ingestReport("tenant-a", {
    resident_id: "res-snap",
    text: "Persona merodeando en el barrio",
  });

  const saved = getReportById("tenant-a", report.id);
  assert.ok(saved);
  const photos = getPhotosForReport(report.id);

  const payload = {
    report_id: "<report_id>",
    status: saved!.status,
    submitted_at: "<iso_timestamp>",
    classified_at: saved!.classified_at ?? null,
    classification: null,
    photo_count: photos.length,
    message: "Tu reporte está siendo procesado.",
  };

  const snapshotPath = path.join(THIS_DIR, "__snapshots__", "communityStatus.snapshot.json");
  const expected = await readFile(snapshotPath, "utf8");
  assert.equal(`${JSON.stringify(payload, null, 2)}\n`, expected);
});
