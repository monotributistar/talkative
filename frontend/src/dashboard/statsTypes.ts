/**
 * Stats Types — Shared interfaces for the stats dashboard.
 * Mirrors the backend statsService.ts response shapes.
 */

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

export interface ByHourResponse {
  hours?: HourBucket[];
  grid?: HourDayBucket[];
}

export interface CategoryStat {
  id: string;
  count: number;
  delta_pct: number | null;
  avg_urgency: number;
  top_subcategories: Array<{ name: string; count: number }>;
}

export interface CategoriesResponse {
  categories: CategoryStat[];
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

export interface HotspotsResponse {
  hotspots: HotspotStat[];
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

export interface RoutingResponse {
  routes: RouteStat[];
}

export interface DateRange {
  from: string;
  to: string;
}

export interface StatsData {
  summary: KPISummary | null;
  timeline: TimelineResponse | null;
  byHour: ByHourResponse | null;
  categories: CategoriesResponse | null;
  hotspots: HotspotsResponse | null;
  routing: RoutingResponse | null;
  reportsGeo: ReportsGeoResponse | null;
}

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

export interface ReportsGeoResponse {
  reports: ReportGeo[];
}
