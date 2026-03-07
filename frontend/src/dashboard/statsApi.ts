/**
 * Stats API client
 *
 * Fetches from /community/stats/* endpoints.
 * Reuses the same auth pattern as the rest of the community API.
 */

import type {
  KPISummary,
  TimelineResponse,
  ByHourResponse,
  CategoriesResponse,
  HotspotsResponse,
  RoutingResponse,
  DateRange,
} from "./statsTypes.js";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:4000";

function getOperatorToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("operator-token") : null;
}

function getTenantId(): string {
  if (typeof window === "undefined") return "tenant-default";
  return localStorage.getItem("tenant_id") ?? localStorage.getItem("x-tenant-id") ?? "tenant-default";
}

async function statsFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    "x-tenant-id": getTenantId(),
  };

  const token = getOperatorToken();
  if (token) headers["x-operator-token"] = token;

  const res = await fetch(url.toString(), { headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Stats API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

function rangeParams(range: DateRange): Record<string, string> {
  return { from: range.from, to: range.to };
}

// ── Endpoints ──────────────────────────────────────────────

export function fetchSummary(): Promise<KPISummary> {
  return statsFetch<KPISummary>("/community/stats/summary");
}

export function fetchTimeline(range: DateRange, granularity = "day"): Promise<TimelineResponse> {
  return statsFetch<TimelineResponse>("/community/stats/timeline", {
    ...rangeParams(range),
    granularity,
  });
}

export function fetchByHour(range: DateRange, mode: "hourly" | "grid" = "grid"): Promise<ByHourResponse> {
  return statsFetch<ByHourResponse>("/community/stats/by-hour", {
    ...rangeParams(range),
    mode,
  });
}

export function fetchCategories(range: DateRange): Promise<CategoriesResponse> {
  return statsFetch<CategoriesResponse>("/community/stats/categories", rangeParams(range));
}

export function fetchHotspots(range: DateRange, limit = 15): Promise<HotspotsResponse> {
  return statsFetch<HotspotsResponse>("/community/stats/hotspots", {
    ...rangeParams(range),
    limit: String(limit),
  });
}

export function fetchRouting(range: DateRange): Promise<RoutingResponse> {
  return statsFetch<RoutingResponse>("/community/stats/routing", rangeParams(range));
}

export function fetchReportsGeo(range: DateRange, category?: string): Promise<import("./statsTypes.js").ReportsGeoResponse> {
  const params: Record<string, string> = { ...rangeParams(range) };
  if (category) params.category = category;
  return statsFetch("/community/stats/reports-geo", params);
}

export function getExportURL(range: DateRange): string {
  const params = new URLSearchParams(rangeParams(range));
  // We can't add headers to a download link, so we'll use a fetch-based download
  return `${API_BASE}/community/stats/export?${params.toString()}`;
}

export async function downloadExport(range: DateRange): Promise<void> {
  const headers: Record<string, string> = {
    "x-tenant-id": getTenantId(),
  };
  const token = getOperatorToken();
  if (token) headers["x-operator-token"] = token;

  const params = new URLSearchParams(rangeParams(range));
  const res = await fetch(`${API_BASE}/community/stats/export?${params.toString()}`, { headers });

  if (!res.ok) throw new Error("Export failed");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reportes_${range.from.slice(0, 10)}_${range.to.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
