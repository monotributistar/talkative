/**
 * Community SQLite Database
 *
 * Standalone SQLite store for the community reporting system.
 * Independent from Prisma/Postgres used by the rest of the app.
 *
 * Tables:
 *   reports         — Resident-submitted reports
 *   classifications — LLM classification results per report
 *   photos          — Uploaded photos linked to reports
 *   notifications   — Outbound notification queue (placeholder)
 *
 * Why separate: Community module can run without Postgres,
 * making local dev and single-VPS deploy simpler.
 * When scaling to multi-tenant Postgres, migrate these tables.
 */

import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

let _db: Database.Database | null = null;

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "community.db");

export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;

  const resolvedPath = dbPath ?? process.env.COMMUNITY_DB_PATH ?? DEFAULT_DB_PATH;

  // Ensure directory exists
  const dir = path.dirname(resolvedPath);
  mkdirSync(dir, { recursive: true });

  _db = new Database(resolvedPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // Run migrations
  migrate(_db);

  return _db;
}

/** For testing: get a fresh in-memory DB */
export function getTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** Close the DB (for graceful shutdown) */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL DEFAULT 'tenant-default',
      resident_id     TEXT NOT NULL,
      text            TEXT NOT NULL,
      category_hint   TEXT,
      address_hint    TEXT,
      lat             REAL,
      lng             REAL,
      status          TEXT NOT NULL DEFAULT 'pending',
      created_at      TEXT NOT NULL,
      classified_at   TEXT,
      urgency         INTEGER,
      category        TEXT,
      subcategory     TEXT,
      routed_to       TEXT,
      summary         TEXT,
      confidence      REAL
    );

    CREATE INDEX IF NOT EXISTS idx_reports_tenant ON reports(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(tenant_id, category);
    CREATE INDEX IF NOT EXISTS idx_reports_urgency ON reports(tenant_id, urgency);
    CREATE INDEX IF NOT EXISTS idx_reports_routed ON reports(tenant_id, routed_to);
    CREATE INDEX IF NOT EXISTS idx_reports_address ON reports(tenant_id, address_hint);

    CREATE TABLE IF NOT EXISTS photos (
      id         TEXT PRIMARY KEY,
      report_id  TEXT NOT NULL,
      filename   TEXT NOT NULL,
      filepath   TEXT NOT NULL,
      mimetype   TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_photos_report ON photos(report_id);

    CREATE TABLE IF NOT EXISTS classification_runs (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      report_count    INTEGER NOT NULL,
      llm_calls       INTEGER NOT NULL,
      tokens_estimate INTEGER NOT NULL,
      duration_ms     INTEGER,
      created_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      report_id   TEXT,
      channel     TEXT NOT NULL,
      destination TEXT NOT NULL,
      payload     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TEXT NOT NULL,
      sent_at     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(tenant_id, status);

    CREATE TABLE IF NOT EXISTS weekly_summaries (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      week_start  TEXT NOT NULL,
      week_end    TEXT NOT NULL,
      data        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      title           TEXT NOT NULL,
      category        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'open',
      severity        INTEGER NOT NULL DEFAULT 1,
      zone            TEXT,
      lat             REAL,
      lng             REAL,
      assigned_to     TEXT,
      resolution_note TEXT,
      created_by      TEXT NOT NULL DEFAULT 'system',
      created_at      TEXT NOT NULL,
      resolved_at     TEXT,
      updated_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_tenant   ON incidents(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_status   ON incidents(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(tenant_id, category);

    CREATE TABLE IF NOT EXISTS incident_events (
      id          TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      payload     TEXT NOT NULL,
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_incident ON incident_events(incident_id);
  `);

  // Additive migration: add incident_id to reports if it doesn't exist yet
  const cols = db.prepare("PRAGMA table_info(reports)").all() as Array<{ name: string }>;
  const hasIncidentId = cols.some((c) => c.name === "incident_id");
  if (!hasIncidentId) {
    db.exec(`ALTER TABLE reports ADD COLUMN incident_id TEXT REFERENCES incidents(id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_incident ON reports(incident_id)`);
  }

  const hasSuggestion = cols.some((c) => c.name === "incident_suggestion");
  if (!hasSuggestion) {
    db.exec(`ALTER TABLE reports ADD COLUMN incident_suggestion TEXT`);
  }
}
