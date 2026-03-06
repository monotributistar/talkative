/**
 * Community Stats Routes
 *
 * All endpoints require operator auth (same as dashboard).
 * All accept ?from=ISO&to=ISO query params for date range.
 * Default range: last 30 days.
 *
 * Endpoints:
 *   GET /community/stats/summary    — KPI overview
 *   GET /community/stats/timeline   — Time series (day/week/month)
 *   GET /community/stats/by-hour    — Activity by hour (or hour×day grid)
 *   GET /community/stats/categories — Breakdown by category with deltas
 *   GET /community/stats/hotspots   — Top recurring locations
 *   GET /community/stats/routing    — Distribution by route/destination
 *   GET /community/stats/export     — CSV download
 */

import { Router } from "express";
import { getTenantIdOrThrow } from "../tenancy/guard.js";
import { requireOperator } from "./auth.js";
import {
  getTimeline,
  getByHour,
  getCategories,
  getHotspots,
  getKPISummary,
  getRouting,
  getExportCSV,
  getReportsGeo,
  type DateRange,
} from "./statsService.js";

export const statsRouter = Router();

// ── Helper: parse date range from query params ─────────────

function parseDateRange(query: Record<string, unknown>): DateRange {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 86400000).toISOString();
  const defaultTo = now.toISOString();

  return {
    from: (query.from as string) || defaultFrom,
    to: (query.to as string) || defaultTo,
  };
}

// ── GET /community/stats/summary ───────────────────────────

statsRouter.get("/community/stats/summary", requireOperator, (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const summary = getKPISummary(tenant_id);
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── GET /community/stats/timeline ──────────────────────────

statsRouter.get("/community/stats/timeline", requireOperator, (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const range = parseDateRange(req.query as Record<string, unknown>);
    const granularity = (req.query.granularity as string) || "day";

    if (!["day", "week", "month"].includes(granularity)) {
      return res.status(400).json({ error: "granularity must be day, week, or month" });
    }

    const result = getTimeline(tenant_id, range, granularity as "day" | "week" | "month");
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── GET /community/stats/by-hour ───────────────────────────

statsRouter.get("/community/stats/by-hour", requireOperator, (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const range = parseDateRange(req.query as Record<string, unknown>);
    const mode = (req.query.mode as string) === "grid" ? "hour_day" : "hourly";

    const result = getByHour(tenant_id, range, mode);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── GET /community/stats/categories ────────────────────────

statsRouter.get("/community/stats/categories", requireOperator, (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const range = parseDateRange(req.query as Record<string, unknown>);

    const result = getCategories(tenant_id, range);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── GET /community/stats/hotspots ──────────────────────────

statsRouter.get("/community/stats/hotspots", requireOperator, (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const range = parseDateRange(req.query as Record<string, unknown>);
    const limit = req.query.limit ? Number(req.query.limit) : 15;

    const result = getHotspots(tenant_id, range, limit);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── GET /community/stats/routing ───────────────────────────

statsRouter.get("/community/stats/routing", requireOperator, (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const range = parseDateRange(req.query as Record<string, unknown>);

    const result = getRouting(tenant_id, range);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── GET /community/stats/reports-geo ────────────────────

statsRouter.get("/community/stats/reports-geo", requireOperator, (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const range = parseDateRange(req.query as Record<string, unknown>);
    const category = (req.query.category as string) || undefined;

    const result = getReportsGeo(tenant_id, range, category);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── GET /community/stats/export ────────────────────────────

statsRouter.get("/community/stats/export", requireOperator, (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const range = parseDateRange(req.query as Record<string, unknown>);

    const csv = getExportCSV(tenant_id, range);

    const filename = `reportes_${range.from.slice(0, 10)}_${range.to.slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});
