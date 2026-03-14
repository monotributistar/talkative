/**
 * Community Store v2 — SQLite-backed
 *
 * Replaces the filesystem JSON store with better-sqlite3.
 * Same public API so routes.ts and agentRunner.ts don't change.
 */

import { nanoid } from "nanoid";
import { getDb } from "./db.js";
import type Database from "better-sqlite3";

// ── Types (unchanged) ──────────────────────────────────────

export interface CommunityReport {
  id: string;
  tenant_id: string;
  resident_id: string;
  text: string;
  timestamp: string;
  location?: {
    lat?: number;
    lng?: number;
    address_hint?: string;
  };
  status: "pending" | "classified";
  classified_at?: string;
  urgency?: number;
  category?: string;
  subcategory?: string;
  routed_to?: string;
  summary?: string;
  confidence?: number;
  photo_count?: number;
}

export interface ClassificationItem {
  report_id: string;
  category: string;
  subcategory: string;
  urgency: number;
  summary: string;
  location_normalized: string | null;
  confidence: number;
  reasoning: string;
  routed_to: string;
}

export interface ClassificationReport {
  ok: boolean;
  generatedAt: string;
  skillName: string;
  data: {
    totals: Record<string, number>;
    items: ClassificationItem[];
    routing_summary: Record<string, {
      label: string;
      count: number;
      highest_urgency: number;
      notify: boolean;
    }>;
  };
  metrics: {
    reportCount: number;
    llmCalls: number;
    totalTokensEstimate: number;
    batchSize: number;
    categoriesVersion: string;
  };
}

export interface DashboardData {
  totals: Record<string, number>;
  routing_summary: Record<string, {
    label: string;
    count: number;
    highest_urgency: number;
    notify: boolean;
  }>;
  recent_items: ClassificationItem[];
  pending_count: number;
  last_classification_at: string | null;
  reports_today: number;
  reports_this_week: number;
}

// ── Urgency Detection ──────────────────────────────────────

const URGENCY_KEYWORDS = [
  "fuego", "incendio", "quemado", "humo", "llama",
  "robo", "robando", "asalto", "asaltando", "arma", "disparo", "tiro",
  "herido", "accidente", "ambulancia", "desmayo",
  "inundacion", "inundación",
];

export function isLikelyUrgent(text: string): boolean {
  const lower = text.toLowerCase();
  return URGENCY_KEYWORDS.some((kw) => lower.includes(kw));
}

let _onUrgentReport: ((tenant_id: string) => void) | null = null;

export function setOnUrgentReport(cb: (tenant_id: string) => void): void {
  _onUrgentReport = cb;
}

// ── Helper ─────────────────────────────────────────────────

function db(): Database.Database {
  return getDb();
}

// ── Public API ─────────────────────────────────────────────

export function ingestReport(
  tenant_id: string,
  input: {
    resident_id: string;
    text: string;
    category_hint?: string;
    location?: { lat?: number; lng?: number; address_hint?: string };
  }
): CommunityReport {
  const id = `report-${nanoid(10)}`;
  const now = new Date().toISOString();

  db().prepare(`
    INSERT INTO reports (id, tenant_id, resident_id, text, category_hint, address_hint, lat, lng, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    tenant_id,
    input.resident_id,
    input.text,
    input.category_hint ?? null,
    input.location?.address_hint ?? null,
    input.location?.lat ?? null,
    input.location?.lng ?? null,
    now,
  );

  const report: CommunityReport = {
    id,
    tenant_id,
    resident_id: input.resident_id,
    text: input.text,
    timestamp: now,
    location: input.location,
    status: "pending",
  };

  // If urgent, trigger auto-classification
  if (isLikelyUrgent(input.text) && _onUrgentReport) {
    try {
      _onUrgentReport(tenant_id);
    } catch {
      // best effort
    }
  }

  return report;
}

export function getReports(
  tenant_id: string,
  filter?: { status?: "pending" | "classified"; limit?: number }
): CommunityReport[] {
  let sql = "SELECT * FROM reports WHERE tenant_id = ?";
  const params: unknown[] = [tenant_id];

  if (filter?.status) {
    sql += " AND status = ?";
    params.push(filter.status);
  }

  sql += " ORDER BY created_at DESC";

  if (filter?.limit) {
    sql += " LIMIT ?";
    params.push(filter.limit);
  }

  const rows = db().prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToReport);
}

export function getReportById(tenant_id: string, reportId: string): CommunityReport | null {
  const row = db().prepare(
    "SELECT * FROM reports WHERE id = ? AND tenant_id = ?"
  ).get(reportId, tenant_id) as Record<string, unknown> | undefined;

  return row ? rowToReport(row) : null;
}

export function getPendingReportsForClassification(tenant_id: string): Array<{
  id: string;
  resident_id: string;
  text: string;
  timestamp: string;
  location?: { address_hint?: string };
}> {
  const rows = db().prepare(
    "SELECT id, resident_id, text, created_at, address_hint FROM reports WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at ASC"
  ).all(tenant_id) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as string,
    resident_id: r.resident_id as string,
    text: r.text as string,
    timestamp: r.created_at as string,
    location: r.address_hint ? { address_hint: r.address_hint as string } : undefined,
  }));
}

export function markReportsClassified(
  tenant_id: string,
  items: ClassificationItem[]
): void {
  const now = new Date().toISOString();

  const stmt = db().prepare(`
    UPDATE reports SET
      status = 'classified',
      classified_at = ?,
      urgency = ?,
      category = ?,
      subcategory = ?,
      routed_to = ?,
      summary = ?,
      confidence = ?,
      address_hint = COALESCE(?, address_hint)
    WHERE id = ? AND tenant_id = ?
  `);

  const tx = db().transaction(() => {
    for (const item of items) {
      stmt.run(
        now,
        item.urgency,
        item.category,
        item.subcategory,
        item.routed_to,
        item.summary,
        item.confidence,
        item.location_normalized,
        item.report_id,
        tenant_id,
      );
    }
  });

  tx();
}

export function saveClassificationRun(
  tenant_id: string,
  metrics: { reportCount: number; llmCalls: number; totalTokensEstimate: number; durationMs?: number }
): string {
  const id = `run-${nanoid(8)}`;
  db().prepare(`
    INSERT INTO classification_runs (id, tenant_id, report_count, llm_calls, tokens_estimate, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenant_id, metrics.reportCount, metrics.llmCalls, metrics.totalTokensEstimate, metrics.durationMs ?? null, new Date().toISOString());
  return id;
}

export function buildDashboard(tenant_id: string): DashboardData {
  const d = db();

  const pendingCount = (d.prepare(
    "SELECT COUNT(*) as c FROM reports WHERE tenant_id = ? AND status = 'pending'"
  ).get(tenant_id) as { c: number }).c;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const reportsToday = (d.prepare(
    "SELECT COUNT(*) as c FROM reports WHERE tenant_id = ? AND created_at >= ?"
  ).get(tenant_id, todayStart) as { c: number }).c;

  const reportsThisWeek = (d.prepare(
    "SELECT COUNT(*) as c FROM reports WHERE tenant_id = ? AND created_at >= ?"
  ).get(tenant_id, weekStart) as { c: number }).c;

  // Get classified reports for totals and routing
  const classified = d.prepare(
    "SELECT * FROM reports WHERE tenant_id = ? AND status = 'classified' ORDER BY classified_at DESC"
  ).all(tenant_id) as Array<Record<string, unknown>>;

  const totals: Record<string, number> = {};
  const routing_summary: Record<string, { label: string; count: number; highest_urgency: number; notify: boolean }> = {};
  const recent_items: ClassificationItem[] = [];

  for (const row of classified) {
    const cat = row.category as string;
    const routed = row.routed_to as string;
    const urgency = row.urgency as number;

    if (cat) totals[cat] = (totals[cat] ?? 0) + 1;

    if (routed) {
      if (!routing_summary[routed]) {
        routing_summary[routed] = {
          label: routed.replace(/_/g, " "),
          count: 0,
          highest_urgency: 0,
          notify: false,
        };
      }
      routing_summary[routed].count++;
      if (urgency > routing_summary[routed].highest_urgency) {
        routing_summary[routed].highest_urgency = urgency;
      }
      if (urgency >= 4) routing_summary[routed].notify = true;
    }

    if (recent_items.length < 20) {
      recent_items.push({
        report_id: row.id as string,
        category: cat ?? "",
        subcategory: (row.subcategory as string) ?? "",
        urgency: urgency ?? 0,
        summary: (row.summary as string) ?? "",
        location_normalized: (row.address_hint as string) ?? null,
        confidence: (row.confidence as number) ?? 0,
        reasoning: "",
        routed_to: routed ?? "",
      });
    }
  }

  const lastRun = d.prepare(
    "SELECT created_at FROM classification_runs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(tenant_id) as { created_at: string } | undefined;

  return {
    totals,
    routing_summary,
    recent_items,
    pending_count: pendingCount,
    last_classification_at: lastRun?.created_at ?? null,
    reports_today: reportsToday,
    reports_this_week: reportsThisWeek,
  };
}

// ── Weekly Summary ─────────────────────────────────────────

export interface WeeklySummary {
  id: string;
  tenant_id: string;
  week_start: string;
  week_end: string;
  total_reports: number;
  by_category: Record<string, number>;
  by_urgency: Record<string, number>;
  by_route: Record<string, number>;
  hotspots: Array<{ address: string; count: number }>;
  avg_urgency: number;
  high_urgency_count: number;
}

export function generateWeeklySummary(tenant_id: string, weekEnd?: Date): WeeklySummary {
  const end = weekEnd ?? new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const rows = db().prepare(
    "SELECT * FROM reports WHERE tenant_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at ASC"
  ).all(tenant_id, startIso, endIso) as Array<Record<string, unknown>>;

  const byCategory: Record<string, number> = {};
  const byUrgency: Record<string, number> = {};
  const byRoute: Record<string, number> = {};
  const addressCounts: Record<string, number> = {};
  let urgencySum = 0;
  let urgencyCount = 0;
  let highUrgency = 0;

  for (const row of rows) {
    const cat = row.category as string;
    const urg = row.urgency as number | null;
    const route = row.routed_to as string;
    const addr = row.address_hint as string;

    if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (urg != null) {
      const key = String(urg);
      byUrgency[key] = (byUrgency[key] ?? 0) + 1;
      urgencySum += urg;
      urgencyCount++;
      if (urg >= 4) highUrgency++;
    }
    if (route) byRoute[route] = (byRoute[route] ?? 0) + 1;
    if (addr) addressCounts[addr] = (addressCounts[addr] ?? 0) + 1;
  }

  const hotspots = Object.entries(addressCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([address, count]) => ({ address, count }));

  const summary: WeeklySummary = {
    id: `weekly-${nanoid(8)}`,
    tenant_id,
    week_start: startIso,
    week_end: endIso,
    total_reports: rows.length,
    by_category: byCategory,
    by_urgency: byUrgency,
    by_route: byRoute,
    hotspots,
    avg_urgency: urgencyCount > 0 ? Math.round((urgencySum / urgencyCount) * 10) / 10 : 0,
    high_urgency_count: highUrgency,
  };

  // Save to DB
  db().prepare(`
    INSERT INTO weekly_summaries (id, tenant_id, week_start, week_end, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(summary.id, tenant_id, startIso, endIso, JSON.stringify(summary), new Date().toISOString());

  return summary;
}

export function getWeeklySummaries(tenant_id: string, limit = 10): WeeklySummary[] {
  const rows = db().prepare(
    "SELECT data FROM weekly_summaries WHERE tenant_id = ? ORDER BY week_end DESC LIMIT ?"
  ).all(tenant_id, limit) as Array<{ data: string }>;

  return rows.map((r) => JSON.parse(r.data) as WeeklySummary);
}

// ── Notification Queue (placeholder) ───────────────────────

export interface NotificationRecord {
  id: string;
  tenant_id: string;
  report_id: string | null;
  channel: string;        // "telegram" | "whatsapp" | "email" | "webhook"
  destination: string;    // chat_id, phone, email, URL
  payload: string;
  status: "pending" | "sent" | "failed";
  created_at: string;
  sent_at: string | null;
}

export function queueNotification(
  tenant_id: string,
  input: { report_id?: string; channel: string; destination: string; payload: Record<string, unknown> }
): NotificationRecord {
  const id = `notif-${nanoid(8)}`;
  const now = new Date().toISOString();

  db().prepare(`
    INSERT INTO notifications (id, tenant_id, report_id, channel, destination, payload, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, tenant_id, input.report_id ?? null, input.channel, input.destination, JSON.stringify(input.payload), now);

  return {
    id,
    tenant_id,
    report_id: input.report_id ?? null,
    channel: input.channel,
    destination: input.destination,
    payload: JSON.stringify(input.payload),
    status: "pending",
    created_at: now,
    sent_at: null,
  };
}

export function getPendingNotifications(tenant_id: string): NotificationRecord[] {
  return db().prepare(
    "SELECT * FROM notifications WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at ASC"
  ).all(tenant_id) as NotificationRecord[];
}

export function markNotificationSent(id: string): void {
  db().prepare(
    "UPDATE notifications SET status = 'sent', sent_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), id);
}

// ── Row mapper ─────────────────────────────────────────────

function rowToReport(row: Record<string, unknown>): CommunityReport {
  const photoCount = db().prepare(
    "SELECT COUNT(*) as c FROM photos WHERE report_id = ?"
  ).get(row.id as string) as { c: number };

  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    resident_id: row.resident_id as string,
    text: row.text as string,
    timestamp: row.created_at as string,
    location: (row.address_hint || row.lat || row.lng) ? {
      lat: row.lat as number | undefined,
      lng: row.lng as number | undefined,
      address_hint: row.address_hint as string | undefined,
    } : undefined,
    status: row.status as "pending" | "classified",
    classified_at: row.classified_at as string | undefined,
    urgency: row.urgency as number | undefined,
    category: row.category as string | undefined,
    subcategory: row.subcategory as string | undefined,
    routed_to: row.routed_to as string | undefined,
    summary: row.summary as string | undefined,
    confidence: row.confidence as number | undefined,
    photo_count: photoCount.c,
  };
}
