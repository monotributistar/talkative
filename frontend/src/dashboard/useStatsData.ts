/**
 * useStatsData — Hook that fetches all stats endpoints in parallel.
 *
 * - Fetches on mount and when dateRange changes
 * - Each section loads independently (partial loading)
 * - Auto-refresh every 60s (only if tab is visible)
 * - Returns loading/error states per section
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { DateRange, StatsData } from "./statsTypes.js";
import {
  fetchSummary,
  fetchTimeline,
  fetchByHour,
  fetchCategories,
  fetchHotspots,
  fetchRouting,
  fetchReportsGeo,
} from "./statsApi.js";

export interface UseStatsResult {
  data: StatsData;
  loading: boolean;
  errors: Partial<Record<keyof StatsData, string>>;
  refresh: () => void;
  lastUpdated: Date | null;
}

const EMPTY_DATA: StatsData = {
  summary: null,
  timeline: null,
  byHour: null,
  categories: null,
  hotspots: null,
  routing: null,
  reportsGeo: null,
};

const REFRESH_INTERVAL = 60_000; // 60 seconds

export function useStatsData(dateRange: DateRange): UseStatsResult {
  const [data, setData] = useState<StatsData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<keyof StatsData, string>>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rangeRef = useRef(dateRange);

  // Keep ref in sync to avoid stale closures in interval
  rangeRef.current = dateRange;

  const fetchAll = useCallback(async () => {
    const range = rangeRef.current;
    setLoading(true);
    const newErrors: Partial<Record<keyof StatsData, string>> = {};

    // Fetch all in parallel — each one independent
    const [
      summaryResult,
      timelineResult,
      byHourResult,
      categoriesResult,
      hotspotsResult,
      routingResult,
      reportsGeoResult,
    ] = await Promise.allSettled([
      fetchSummary(),
      fetchTimeline(range, "day"),
      fetchByHour(range, "grid"),
      fetchCategories(range),
      fetchHotspots(range, 15),
      fetchRouting(range),
      fetchReportsGeo(range),
    ]);

    setData({
      summary: summaryResult.status === "fulfilled" ? summaryResult.value : null,
      timeline: timelineResult.status === "fulfilled" ? timelineResult.value : null,
      byHour: byHourResult.status === "fulfilled" ? byHourResult.value : null,
      categories: categoriesResult.status === "fulfilled" ? categoriesResult.value : null,
      hotspots: hotspotsResult.status === "fulfilled" ? hotspotsResult.value : null,
      routing: routingResult.status === "fulfilled" ? routingResult.value : null,
      reportsGeo: reportsGeoResult.status === "fulfilled" ? reportsGeoResult.value : null,
    });

    // Collect errors
    if (summaryResult.status === "rejected") newErrors.summary = summaryResult.reason?.message;
    if (timelineResult.status === "rejected") newErrors.timeline = timelineResult.reason?.message;
    if (byHourResult.status === "rejected") newErrors.byHour = byHourResult.reason?.message;
    if (categoriesResult.status === "rejected") newErrors.categories = categoriesResult.reason?.message;
    if (hotspotsResult.status === "rejected") newErrors.hotspots = hotspotsResult.reason?.message;
    if (routingResult.status === "rejected") newErrors.routing = routingResult.reason?.message;
    if (reportsGeoResult.status === "rejected") newErrors.reportsGeo = reportsGeoResult.reason?.message;

    setErrors(newErrors);
    setLoading(false);
    setLastUpdated(new Date());
  }, []);

  // Fetch on mount and when range changes
  useEffect(() => {
    void fetchAll();
  }, [dateRange.from, dateRange.to, fetchAll]);

  // Auto-refresh every 60s, only when tab is visible
  useEffect(() => {
    function startInterval() {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        if (document.visibilityState === "visible") {
          void fetchAll();
        }
      }, REFRESH_INTERVAL);
    }

    startInterval();

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        void fetchAll();
        startInterval();
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchAll]);

  return { data, loading, errors, refresh: fetchAll, lastUpdated };
}
