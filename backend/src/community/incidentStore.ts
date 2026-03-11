/**
 * Incident Store — SQLite-backed
 *
 * Manages Incidents (parent objects) and their lifecycle.
 * Reports link to Incidents via incident_id FK.
 * All state transitions are recorded in incident_events.
 */

import { nanoid } from "nanoid";
import { getDb } from "./db.js";
import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────────────────────────

export type IncidentStatus = "open" | "in_progress" | "resolved" | "closed" | "re_opened";

export type IncidentEventType =
  | "status_change"
  | "report_linked"
  | "report_unlinked"
  | "note_added"
  | "assigned"
  | "created";

export interface Incident {
  id: string;
  tenant_id: string;
  title: string;
  category: string;
  status: IncidentStatus;
  severity: number;
  zone: string | null;
  lat: number | null;
  lng: number | null;
  assigned_to: string | null;
  resolution_note: string | null;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  updated_at: string;
  report_count?: number;
}

export interface IncidentEvent {
  id: string;
  incident_id: string;
  event_type: IncidentEventType;
  payload: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface IncidentSuggestion {
  incident_id: string;
  confidence: number;
  reasoning: string;
}

// ── Config ─────────────────────────────────────────────────────────────────────

export const AUTO_CREATE_THRESHOLD = 0.80;
export const SUGGEST_THRESHOLD = 0.50;

// ── Helper ─────────────────────────────────────────────────────────────────────

function db(): Database.Database {
  return getDb();
}

function now(): string {
  return new Date().toISOString();
}

function recordEvent(
  incident_id: string,
  event_type: IncidentEventType,
  payload: Record<string, unknown>,
  created_by: string
): void {
  db().prepare(`
    INSERT INTO incident_events (id, incident_id, event_type, payload, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(nanoid(10), incident_id, event_type, JSON.stringify(payload), created_by, now());
}

// ── Create ─────────────────────────────────────────────────────────────────────

export function createIncident(
  tenant_id: string,
  input: {
    title: string;
    category: string;
    severity?: number;
    zone?: string;
    lat?: number;
    lng?: number;
    created_by?: string;
  }
): Incident {
  const id = `incident-${nanoid(10)}`;
  const ts = now();

  db().prepare(`
    INSERT INTO incidents
      (id, tenant_id, title, category, status, severity, zone, lat, lng, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, tenant_id, input.title, input.category,
    input.severity ?? 1, input.zone ?? null,
    input.lat ?? null, input.lng ?? null,
    input.created_by ?? "system", ts, ts,
  );

  recordEvent(id, "created", { title: input.title, category: input.category }, input.created_by ?? "system");
  return getIncidentById(tenant_id, id)!;
}

// ── Read ───────────────────────────────────────────────────────────────────────

export function getIncidents(
  tenant_id: string,
  filter?: { status?: IncidentStatus; category?: string; limit?: number }
): Incident[] {
  let sql = "SELECT * FROM incidents WHERE tenant_id = ?";
  const params: unknown[] = [tenant_id];

  if (filter?.status) { sql += " AND status = ?"; params.push(filter.status); }
  if (filter?.category) { sql += " AND category = ?"; params.push(filter.category); }

  sql += " ORDER BY updated_at DESC";
  if (filter?.limit) { sql += " LIMIT ?"; params.push(filter.limit); }

  const rows = db().prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToIncident);
}

export function getIncidentById(tenant_id: string, id: string): Incident | null {
  const row = db().prepare(
    "SELECT * FROM incidents WHERE id = ? AND tenant_id = ?"
  ).get(id, tenant_id) as Record<string, unknown> | undefined;
  return row ? rowToIncident(row) : null;
}

export function getOpenIncidentsByCategory(tenant_id: string, category: string): Incident[] {
  const rows = db().prepare(`
    SELECT * FROM incidents
    WHERE tenant_id = ? AND category = ? AND status IN ('open', 'in_progress', 're_opened')
    ORDER BY updated_at DESC LIMIT 20
  `).all(tenant_id, category) as Array<Record<string, unknown>>;
  return rows.map(rowToIncident);
}

export function getIncidentEvents(incident_id: string): IncidentEvent[] {
  const rows = db().prepare(
    "SELECT * FROM incident_events WHERE incident_id = ? ORDER BY created_at ASC"
  ).all(incident_id) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as string,
    incident_id: r.incident_id as string,
    event_type: r.event_type as IncidentEventType,
    payload: JSON.parse(r.payload as string) as Record<string, unknown>,
    created_by: r.created_by as string,
    created_at: r.created_at as string,
  }));
}

// ── Update status ──────────────────────────────────────────────────────────────

export function updateIncidentStatus(
  tenant_id: string,
  incident_id: string,
  newStatus: IncidentStatus,
  options?: { resolution_note?: string; updated_by?: string }
): Incident | null {
  const incident = getIncidentById(tenant_id, incident_id);
  if (!incident) return null;

  const ts = now();
  const resolved_at = newStatus === "resolved" ? ts : incident.resolved_at;

  db().prepare(`
    UPDATE incidents SET
      status = ?,
      resolution_note = COALESCE(?, resolution_note),
      resolved_at = ?,
      updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(newStatus, options?.resolution_note ?? null, resolved_at, ts, incident_id, tenant_id);

  recordEvent(
    incident_id, "status_change",
    { from: incident.status, to: newStatus, note: options?.resolution_note ?? null },
    options?.updated_by ?? "system"
  );

  return getIncidentById(tenant_id, incident_id);
}

// ── Assign ─────────────────────────────────────────────────────────────────────

export function assignIncident(
  tenant_id: string,
  incident_id: string,
  assigned_to: string,
  updated_by?: string
): Incident | null {
  const incident = getIncidentById(tenant_id, incident_id);
  if (!incident) return null;

  db().prepare(
    "UPDATE incidents SET assigned_to = ?, updated_at = ? WHERE id = ? AND tenant_id = ?"
  ).run(assigned_to, now(), incident_id, tenant_id);

  recordEvent(incident_id, "assigned", { from: incident.assigned_to, to: assigned_to }, updated_by ?? "system");
  return getIncidentById(tenant_id, incident_id);
}

// ── Link / Unlink reports ──────────────────────────────────────────────────────

export function linkReportToIncident(
  tenant_id: string,
  report_id: string,
  incident_id: string,
  linked_by?: string
): boolean {
  const incident = getIncidentById(tenant_id, incident_id);
  if (!incident) return false;

  db().prepare(
    "UPDATE reports SET incident_id = ? WHERE id = ? AND tenant_id = ?"
  ).run(incident_id, report_id, tenant_id);

  db().prepare("UPDATE incidents SET updated_at = ? WHERE id = ?").run(now(), incident_id);

  recordEvent(incident_id, "report_linked", { report_id }, linked_by ?? "system");

  if (incident.status === "resolved" || incident.status === "closed") {
    updateIncidentStatus(tenant_id, incident_id, "re_opened", { updated_by: "system" });
  }

  return true;
}

export function unlinkReportFromIncident(
  tenant_id: string,
  report_id: string,
  unlinked_by?: string
): boolean {
  const row = db().prepare(
    "SELECT incident_id FROM reports WHERE id = ? AND tenant_id = ?"
  ).get(report_id, tenant_id) as { incident_id: string | null } | undefined;

  if (!row?.incident_id) return false;

  const incident_id = row.incident_id;

  db().prepare("UPDATE reports SET incident_id = NULL WHERE id = ? AND tenant_id = ?").run(report_id, tenant_id);
  db().prepare("UPDATE incidents SET updated_at = ? WHERE id = ?").run(now(), incident_id);
  recordEvent(incident_id, "report_unlinked", { report_id }, unlinked_by ?? "system");

  return true;
}

// ── Row mapper ─────────────────────────────────────────────────────────────────

function rowToIncident(row: Record<string, unknown>): Incident {
  const reportCount = db().prepare(
    "SELECT COUNT(*) as c FROM reports WHERE incident_id = ?"
  ).get(row.id as string) as { c: number };

  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    title: row.title as string,
    category: row.category as string,
    status: row.status as IncidentStatus,
    severity: row.severity as number,
    zone: row.zone as string | null,
    lat: row.lat as number | null,
    lng: row.lng as number | null,
    assigned_to: row.assigned_to as string | null,
    resolution_note: row.resolution_note as string | null,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    resolved_at: row.resolved_at as string | null,
    updated_at: row.updated_at as string,
    report_count: reportCount.c,
  };
}
