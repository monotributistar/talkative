/**
 * Community Stats Service
 *
 * Pure SQL queries against the community SQLite database.
 * All functions take tenant_id + date range and return typed results.
 * No side effects, no LLM calls — just reads.
 */

import { getDb } from "./db.js";
import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────

export interface DateRange {
  from: string;  // ISO date
  to: string;    // ISO date
}

export interface TimelinePoint {
  date: string;
  total: number;
  classified: number;
  pending: number;
  avg_urgency: number;
}

export interface TimelineResponse {
  points: TimelinePoint[];
  delta_pct: number | null;
  previous_total: number;
  current_total: number;
}

export interface HourBucket {
  hour: number;
  count: number;
  avg_urgency: number;
}

export interface HourDayBucket {
  day_of_week: number;
  hour: number;
  count: number;
  avg_urgency: number;
}

export interface CategoryStat {
  id: string;
  count: number;
  delta_pct: number | null;
  avg_urgency: number;
  top_subcategories: Array<{ name: string; count: number }>;
}

export interface HotspotStat {
  address: string;
  count: number;
  avg_urgency: number;
  top_category: string;
  last_report_at: string;
  lat: number | null;
  lng: number | null;
}

export interface KPISummary {
  total: number;
  today: number;
  this_week: number;
  this_month: number;
  delta_week_pct: number | null;
  delta_month_pct: number | null;
  avg_urgency: number;
  urgency_trend: "up" | "down" | "stable";
  avg_classification_time_s: number | null;
  top_category: string | null;
  pending: number;
  high_urgency: number;
}

export interface RouteStat {
  id: string;
  label: string;
  total: number;
  last_24h: number;
  avg_urgency: number;
  max_urgency: number;
}

// ── Helpers ────────────────────────────────────────────────

function db(): Database.Database {
  return getDb();
}

// function isoNow(): string { return new Date().toISOString(); }

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// startOfWeek and startOfMonth reserved for future granularity filters
// function startOfWeek(): string { ... }
// function startOfMonth(): string { ... }

// ── A1: Timeline ───────────────────────────────────────────

export function getTimeline(
  tenant_id: string,
  range: DateRange,
  granularity: "day" | "week" | "month" = "day"
): TimelineResponse {
  const formatStr = granularity === "day"
    ? "%Y-%m-%d"
    : granularity === "week"
      ? "%Y-W%W"
      : "%Y-%m";

  const points = db().prepare(`
    SELECT
      strftime('${formatStr}', created_at) AS date,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'classified' THEN 1 ELSE 0 END) AS classified,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      ROUND(AVG(CASE WHEN urgency IS NOT NULL THEN urgency END), 1) AS avg_urgency
    FROM reports
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
    GROUP BY date
    ORDER BY date ASC
  `).all(tenant_id, range.from, range.to) as TimelinePoint[];

  // Calculate delta vs previous period
  const rangeDuration = new Date(range.to).getTime() - new Date(range.from).getTime();
  const prevFrom = new Date(new Date(range.from).getTime() - rangeDuration).toISOString();

  const currentTotal = points.reduce((s, p) => s + p.total, 0);
  const prevResult = db().prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE tenant_id = ? AND created_at >= ? AND created_at < ?"
  ).get(tenant_id, prevFrom, range.from) as { c: number };
  const previousTotal = prevResult.c;

  const delta_pct = previousTotal > 0
    ? Math.round(((currentTotal - previousTotal) / previousTotal) * 100)
    : null;

  return { points, delta_pct, previous_total: previousTotal, current_total: currentTotal };
}

// ── A2: By Hour ────────────────────────────────────────────

export function getByHour(
  tenant_id: string,
  range: DateRange,
  mode: "hourly" | "hour_day" = "hourly"
): { hours?: HourBucket[]; grid?: HourDayBucket[] } {
  if (mode === "hour_day") {
    const grid = db().prepare(`
      SELECT
        CAST(strftime('%w', created_at) AS INTEGER) AS day_of_week,
        CAST(strftime('%H', created_at) AS INTEGER) AS hour,
        COUNT(*) AS count,
        ROUND(AVG(CASE WHEN urgency IS NOT NULL THEN urgency END), 1) AS avg_urgency
      FROM reports
      WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).all(tenant_id, range.from, range.to) as HourDayBucket[];
    return { grid };
  }

  const hours = db().prepare(`
    SELECT
      CAST(strftime('%H', created_at) AS INTEGER) AS hour,
      COUNT(*) AS count,
      ROUND(AVG(CASE WHEN urgency IS NOT NULL THEN urgency END), 1) AS avg_urgency
    FROM reports
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
    GROUP BY hour
    ORDER BY hour
  `).all(tenant_id, range.from, range.to) as HourBucket[];

  return { hours };
}

// ── A3: Categories ─────────────────────────────────────────

export function getCategories(
  tenant_id: string,
  range: DateRange
): { categories: CategoryStat[] } {
  // Current period
  const rows = db().prepare(`
    SELECT
      category AS id,
      COUNT(*) AS count,
      ROUND(AVG(urgency), 1) AS avg_urgency
    FROM reports
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
      AND status = 'classified' AND category IS NOT NULL
    GROUP BY category
    ORDER BY count DESC
  `).all(tenant_id, range.from, range.to) as Array<{ id: string; count: number; avg_urgency: number }>;

  // Previous period for delta
  const rangeDuration = new Date(range.to).getTime() - new Date(range.from).getTime();
  const prevFrom = new Date(new Date(range.from).getTime() - rangeDuration).toISOString();

  const prevRows = db().prepare(`
    SELECT category AS id, COUNT(*) AS count
    FROM reports
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
      AND status = 'classified' AND category IS NOT NULL
    GROUP BY category
  `).all(tenant_id, prevFrom, range.from) as Array<{ id: string; count: number }>;

  const prevMap = new Map(prevRows.map(r => [r.id, r.count]));

  // Top subcategories per category
  const subRows = db().prepare(`
    SELECT category, subcategory AS name, COUNT(*) AS count
    FROM reports
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
      AND status = 'classified' AND subcategory IS NOT NULL
    GROUP BY category, subcategory
    ORDER BY category, count DESC
  `).all(tenant_id, range.from, range.to) as Array<{ category: string; name: string; count: number }>;

  const subMap = new Map<string, Array<{ name: string; count: number }>>();
  for (const row of subRows) {
    if (!subMap.has(row.category)) subMap.set(row.category, []);
    const arr = subMap.get(row.category)!;
    if (arr.length < 5) arr.push({ name: row.name, count: row.count });
  }

  const categories: CategoryStat[] = rows.map(r => {
    const prev = prevMap.get(r.id) ?? 0;
    return {
      id: r.id,
      count: r.count,
      delta_pct: prev > 0 ? Math.round(((r.count - prev) / prev) * 100) : null,
      avg_urgency: r.avg_urgency,
      top_subcategories: subMap.get(r.id) ?? [],
    };
  });

  return { categories };
}

// ── A4: Hotspots ───────────────────────────────────────────

export function getHotspots(
  tenant_id: string,
  range: DateRange,
  limit = 15
): { hotspots: HotspotStat[] } {
  const hotspots = db().prepare(`
    SELECT
      address_hint AS address,
      COUNT(*) AS count,
      ROUND(AVG(urgency), 1) AS avg_urgency,
      (
        SELECT r2.category FROM reports r2
        WHERE r2.tenant_id = reports.tenant_id
          AND r2.address_hint = reports.address_hint
          AND r2.category IS NOT NULL
        GROUP BY r2.category ORDER BY COUNT(*) DESC LIMIT 1
      ) AS top_category,
      MAX(created_at) AS last_report_at,
      AVG(lat) AS lat,
      AVG(lng) AS lng
    FROM reports
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
      AND address_hint IS NOT NULL AND address_hint != ''
    GROUP BY address_hint
    ORDER BY count DESC
    LIMIT ?
  `).all(tenant_id, range.from, range.to, limit) as HotspotStat[];

  return { hotspots };
}

// ── A5: KPI Summary ────────────────────────────────────────

export function getKPISummary(tenant_id: string): KPISummary {
  const d = db();
  const todayStart = startOfToday();
  const weekStart = daysAgo(7);
  const lastWeekStart = daysAgo(14);
  const monthStart = daysAgo(30);
  const lastMonthStart = daysAgo(60);

  const total = (d.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE tenant_id = ?"
  ).get(tenant_id) as { c: number }).c;

  const today = (d.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE tenant_id = ? AND created_at >= ?"
  ).get(tenant_id, todayStart) as { c: number }).c;

  const thisWeek = (d.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE tenant_id = ? AND created_at >= ?"
  ).get(tenant_id, weekStart) as { c: number }).c;

  const lastWeek = (d.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE tenant_id = ? AND created_at >= ? AND created_at < ?"
  ).get(tenant_id, lastWeekStart, weekStart) as { c: number }).c;

  const thisMonth = (d.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE tenant_id = ? AND created_at >= ?"
  ).get(tenant_id, monthStart) as { c: number }).c;

  const lastMonth = (d.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE tenant_id = ? AND created_at >= ? AND created_at < ?"
  ).get(tenant_id, lastMonthStart, monthStart) as { c: number }).c;

  const pending = (d.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE tenant_id = ? AND status = 'pending'"
  ).get(tenant_id) as { c: number }).c;

  const highUrgency = (d.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE tenant_id = ? AND urgency >= 4"
  ).get(tenant_id) as { c: number }).c;

  // Urgency stats
  const urgStats = d.prepare(`
    SELECT
      ROUND(AVG(urgency), 2) AS avg_all,
      ROUND(AVG(CASE WHEN created_at >= ? THEN urgency END), 2) AS avg_recent,
      ROUND(AVG(CASE WHEN created_at >= ? AND created_at < ? THEN urgency END), 2) AS avg_prev
    FROM reports
    WHERE tenant_id = ? AND urgency IS NOT NULL
  `).get(lastWeekStart, lastWeekStart, weekStart, tenant_id) as {
    avg_all: number | null;
    avg_recent: number | null;
    avg_prev: number | null;
  };

  const avgUrgency = urgStats.avg_all ?? 0;
  let urgencyTrend: "up" | "down" | "stable" = "stable";
  if (urgStats.avg_recent != null && urgStats.avg_prev != null) {
    const diff = urgStats.avg_recent - urgStats.avg_prev;
    if (diff > 0.3) urgencyTrend = "up";
    else if (diff < -0.3) urgencyTrend = "down";
  }

  // Avg classification time
  const classTimeResult = d.prepare(`
    SELECT AVG(
      (julianday(classified_at) - julianday(created_at)) * 86400
    ) AS avg_seconds
    FROM reports
    WHERE tenant_id = ? AND classified_at IS NOT NULL AND created_at IS NOT NULL
  `).get(tenant_id) as { avg_seconds: number | null };

  // Top category
  const topCatResult = d.prepare(`
    SELECT category, COUNT(*) AS c
    FROM reports
    WHERE tenant_id = ? AND category IS NOT NULL
    GROUP BY category ORDER BY c DESC LIMIT 1
  `).get(tenant_id) as { category: string; c: number } | undefined;

  return {
    total,
    today,
    this_week: thisWeek,
    this_month: thisMonth,
    delta_week_pct: lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null,
    delta_month_pct: lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null,
    avg_urgency: avgUrgency,
    urgency_trend: urgencyTrend,
    avg_classification_time_s: classTimeResult.avg_seconds != null
      ? Math.round(classTimeResult.avg_seconds)
      : null,
    top_category: topCatResult?.category ?? null,
    pending,
    high_urgency: highUrgency,
  };
}

// ── A6: Routing ────────────────────────────────────────────

export function getRouting(
  tenant_id: string,
  range: DateRange
): { routes: RouteStat[] } {
  const now24h = daysAgo(1);

  const routes = db().prepare(`
    SELECT
      routed_to AS id,
      REPLACE(routed_to, '_', ' ') AS label,
      COUNT(*) AS total,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_24h,
      ROUND(AVG(urgency), 1) AS avg_urgency,
      MAX(urgency) AS max_urgency
    FROM reports
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
      AND routed_to IS NOT NULL
    GROUP BY routed_to
    ORDER BY total DESC
  `).all(now24h, tenant_id, range.from, range.to) as RouteStat[];

  return { routes };
}

// ── A8: Export CSV ─────────────────────────────────────────

export function getExportCSV(
  tenant_id: string,
  range: DateRange
): string {
  const rows = db().prepare(`
    SELECT
      id, created_at, classified_at, status, category, subcategory,
      urgency, address_hint, summary, routed_to, confidence, lat, lng
    FROM reports
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
    ORDER BY created_at DESC
  `).all(tenant_id, range.from, range.to) as Array<Record<string, unknown>>;

  const headers = [
    "id", "fecha_creacion", "fecha_clasificacion", "estado", "categoria",
    "subcategoria", "urgencia", "ubicacion", "resumen", "derivado_a",
    "confianza", "latitud", "longitud"
  ];

  const csvRows = rows.map(r => [
    r.id,
    r.created_at,
    r.classified_at ?? "",
    r.status,
    r.category ?? "",
    r.subcategory ?? "",
    r.urgency ?? "",
    r.address_hint ?? "",
    `"${((r.summary as string) ?? "").replace(/"/g, '""')}"`,
    r.routed_to ?? "",
    r.confidence ?? "",
    r.lat ?? "",
    r.lng ?? "",
  ].join(","));

  return [headers.join(","), ...csvRows].join("\n");
}

// ── Reports Geo (individual reports with coordinates) ────

export interface ReportGeo {
  id: string;
  lat: number;
  lng: number;
  address: string | null;
  category: string;
  subcategory: string | null;
  urgency: number;
  summary: string | null;
  confidence: number | null;
  routed_to: string | null;
  created_at: string;
}

export function getReportsGeo(
  tenant_id: string,
  range: DateRange,
  category?: string
): { reports: ReportGeo[] } {
  let sql = `
    SELECT id, lat, lng, address_hint AS address, category, subcategory,
           urgency, summary, confidence, routed_to, created_at
    FROM reports
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
      AND status = 'classified' AND lat IS NOT NULL AND lng IS NOT NULL
  `;
  const params: unknown[] = [tenant_id, range.from, range.to];

  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }

  sql += " ORDER BY created_at DESC LIMIT 500";

  const reports = db().prepare(sql).all(...params) as ReportGeo[];
  return { reports };
}
