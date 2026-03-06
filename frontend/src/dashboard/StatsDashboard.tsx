/**
 * Stats Dashboard — Leaflet map + D3 hybrid charts
 *
 * Connected to /community/stats/* API endpoints.
 * Falls back to mock data if backend is unreachable.
 *
 * Leaflet loaded via CDN in index.html:
 *   - CARTO Voyager tiles (light)
 *   - leaflet.heat for heatmap overlay
 *   - leaflet.markercluster for grouping
 */

import { useState, useEffect, useRef, useMemo } from "react";
import "./stats.css";
import { useStatsData } from "./useStatsData.js";
import { downloadExport } from "./statsApi.js";
import type { DateRange, KPISummary, CategoriesResponse, HotspotsResponse, ByHourResponse, HotspotStat, ReportGeo } from "./statsTypes.js";

// ── Constants ──────────────────────────────────────────────

const CATEGORIES: Record<string, { color: string; bg: string; emoji: string; label: string }> = {
  seguridad:     { color: "#ef4444", bg: "rgba(239,68,68,0.12)",  emoji: "🚨", label: "Seguridad" },
  bomberos:      { color: "#f97316", bg: "rgba(249,115,22,0.12)", emoji: "🔥", label: "Bomberos" },
  vialidad:      { color: "#eab308", bg: "rgba(234,179,8,0.12)",  emoji: "🚧", label: "Vialidad" },
  convivencia:   { color: "#22c55e", bg: "rgba(34,197,94,0.12)",  emoji: "📢", label: "Convivencia" },
  fiscalizacion: { color: "#a855f7", bg: "rgba(168,85,247,0.12)", emoji: "🏗️", label: "Fiscalización" },
  municipal:     { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", emoji: "📋", label: "Municipal" },
};

function getCat(id: string) {
  return CATEGORIES[id] ?? { color: "#64748b", bg: "rgba(100,116,139,0.12)", emoji: "📌", label: id };
}

// ── Date Range Presets ─────────────────────────────────────

function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

const RANGE_PRESETS: Array<{ label: string; range: DateRange }> = [
  { label: "7d",  range: { from: daysAgoISO(7),  to: new Date().toISOString() } },
  { label: "30d", range: { from: daysAgoISO(30), to: new Date().toISOString() } },
  { label: "90d", range: { from: daysAgoISO(90), to: new Date().toISOString() } },
];

// ── Leaflet Map ────────────────────────────────────────────

declare const L: typeof import("leaflet");

function StatsMap({ reports }: { reports: ReportGeo[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<L.Map | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const heatLayer = useRef<L.Layer | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    if (typeof L === "undefined") return;

    const map = L.map(mapRef.current, {
      center: [-37.1625, -56.9010],
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19, subdomains: "abcd",
    }).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: false })
      .addAttribution('© <a href="https://osm.org">OSM</a> · <a href="https://carto.com">CARTO</a>')
      .addTo(map);

    mapInst.current = map;
    return () => { map.remove(); mapInst.current = null; };
  }, []);

  useEffect(() => {
    const map = mapInst.current;
    if (!map || typeof L === "undefined") return;

    if (markersLayer.current) { map.removeLayer(markersLayer.current); markersLayer.current = null; }
    if (heatLayer.current) { map.removeLayer(heatLayer.current); heatLayer.current = null; }

    if (reports.length === 0) return;

    // Heatmap config — added after fitBounds completes to avoid canvas height=0 crash
    const heatData = reports.map(r => [r.lat, r.lng, r.urgency / 5]);
    const addHeat = () => {
      try {
        if (!mapInst.current || heatLayer.current) return;
        const hl = (L as any).heatLayer(heatData, {
          radius: 18, blur: 15, maxZoom: 17, max: 1.0, minOpacity: 0.0,
          gradient: {
            0.0: "rgba(34,197,94,0.0)", 0.2: "rgba(34,197,94,0.25)",
            0.4: "rgba(253,224,71,0.35)", 0.6: "rgba(251,146,60,0.45)",
            0.8: "rgba(239,68,68,0.55)", 1.0: "rgba(220,38,38,0.7)",
          },
        }).addTo(mapInst.current);
        heatLayer.current = hl;
      } catch (_) { /* ignore */ }
    };

    // Clusters with individual report markers
    const cluster = (L as any).markerClusterGroup({
      maxClusterRadius: 40, spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: true,
      iconCreateFunction: (cl: any) => {
        const n = cl.getChildCount();
        const maxU = Math.max(...cl.getAllChildMarkers().map((m: any) => m.options.urgency || 1));
        const col = maxU >= 4 ? "#ef4444" : maxU >= 3 ? "#f97316" : "#22c55e";
        const sz = n > 20 ? 46 : n > 10 ? 38 : 30;
        return L.divIcon({
          html: `<div class="stats-cluster" style="width:${sz}px;height:${sz}px;background:rgba(255,255,255,0.85);border-color:${col};color:${col};box-shadow:0 2px 8px rgba(0,0,0,0.15), 0 0 0 3px ${col}33;font-size:${sz > 38 ? 14 : 11}px;">${n}</div>`,
          className: "", iconSize: [sz, sz] as [number, number],
        });
      },
    });

    for (const r of reports) {
      const cat = getCat(r.category);
      const urgCol = r.urgency >= 4 ? "#ef4444" : r.urgency >= 3 ? "#f97316" : r.urgency >= 2 ? "#eab308" : "#22c55e";
      const urgLbl = r.urgency >= 5 ? "EMERGENCIA" : r.urgency >= 4 ? "ALTA" : r.urgency >= 3 ? "MEDIA" : r.urgency >= 2 ? "BAJA" : "INFO";

      const icon = L.divIcon({
        html: `<div class="stats-marker" style="background:${cat.color};box-shadow:0 0 6px ${cat.color}88;"></div>`,
        className: "", iconSize: [14, 14] as [number, number], iconAnchor: [7, 7] as [number, number],
      });

      const dateStr = new Date(r.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

      const marker = L.marker([r.lat, r.lng], { icon, urgency: r.urgency } as any);
      marker.bindPopup(`
        <div class="stats-popup">
          <div class="stats-popup-header">
            <span class="stats-popup-cat">${cat.emoji} ${cat.label}</span>
            <span class="stats-popup-urg" style="background:${urgCol}22;color:${urgCol};">${urgLbl}</span>
          </div>
          <div class="stats-popup-summary">${r.summary ?? "Sin resumen"}</div>
          <div class="stats-popup-meta">
            <div>📍 ${r.address ?? "Sin ubicación"}</div>
            <div class="stats-popup-meta-row">
              <span>🕐 ${dateStr}</span>
              <span>${r.confidence != null ? Math.round(r.confidence * 100) + "% conf." : ""}</span>
            </div>
          </div>
        </div>
      `, { maxWidth: 280 });

      cluster.addLayer(marker);
    }

    map.addLayer(cluster);
    markersLayer.current = cluster;

    // Fit bounds, then add heatmap once map has settled
    if (reports.length > 1) {
      const bounds = L.latLngBounds(reports.map(r => [r.lat, r.lng] as [number, number]));
      map.once('moveend', () => setTimeout(addHeat, 100));
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    } else {
      setTimeout(addHeat, 300);
    }
  }, [reports]);

  return (
    <div className="stats-map-container">
      <div ref={mapRef} className="stats-map" />
      <div className="stats-map-legend">
        <span className="stats-map-legend-label">Intensidad</span>
        <div className="stats-map-legend-bar" />
        <div className="stats-map-legend-labels">
          <span>Baja</span>
          <span>Alta</span>
        </div>
      </div>
    </div>
  );
}

// ── KPI Strip (from API) ───────────────────────────────────

function KPIStripAPI({ summary }: { summary: KPISummary | null }) {
  if (!summary) {
    return (
      <div className="stats-kpi-bar">
        <div className="stats-kpi-item"><span className="stats-kpi-val">—</span><span className="stats-kpi-lbl">CARGANDO</span></div>
      </div>
    );
  }

  // Determine status color per KPI
  const urgStatus = summary.avg_urgency >= 3.5 ? "danger" : summary.avg_urgency >= 2.5 ? "warn" : "ok";
  const highStatus = summary.high_urgency >= 10 ? "danger" : summary.high_urgency >= 5 ? "warn" : "ok";
  const pendingStatus = summary.pending >= 10 ? "danger" : summary.pending >= 3 ? "warn" : "ok";

  return (
    <div className="stats-kpi-bar">
      <div className="stats-kpi-item">
        <span className="stats-kpi-val">{summary.today}</span>
        <span className="stats-kpi-lbl">HOY</span>
      </div>
      <div className="stats-kpi-divider" />
      <div className="stats-kpi-item">
        <span className="stats-kpi-val">
          {summary.this_week}
          {summary.delta_week_pct != null && summary.delta_week_pct !== 0 && (
            <span className={`stats-kpi-delta ${summary.delta_week_pct > 0 ? "up" : "down"}`}>
              {summary.delta_week_pct > 0 ? "↑" : "↓"}{Math.abs(summary.delta_week_pct)}%
            </span>
          )}
        </span>
        <span className="stats-kpi-lbl">SEMANA</span>
      </div>
      <div className="stats-kpi-divider" />
      <div className={`stats-kpi-item stats-kpi-${urgStatus}`}>
        <span className="stats-kpi-val">{summary.avg_urgency.toFixed(1)}</span>
        <span className="stats-kpi-lbl">URG. PROM</span>
      </div>
      <div className="stats-kpi-divider" />
      <div className={`stats-kpi-item stats-kpi-${highStatus}`}>
        <span className="stats-kpi-val">{summary.high_urgency}</span>
        <span className="stats-kpi-lbl">ALTA URG.</span>
      </div>
      <div className="stats-kpi-divider" />
      <div className={`stats-kpi-item stats-kpi-${pendingStatus}`}>
        <span className="stats-kpi-val">{summary.pending}</span>
        <span className="stats-kpi-lbl">PENDIENTES</span>
      </div>
    </div>
  );
}

// ── Category Filter (from API categories) ──────────────────

function CategoryFilterAPI({ categories, active, onChange }: {
  categories: CategoriesResponse | null; active: string; onChange: (c: string) => void;
}) {
  const total = categories?.categories.reduce((s, c) => s + c.count, 0) ?? 0;

  return (
    <div className="stats-cat-filter">
      <button className={`stats-cat-pill ${active === "all" ? "active" : ""}`} onClick={() => onChange("all")}>
        Todos · {total}
      </button>
      {(categories?.categories ?? []).map(c => {
        const cat = getCat(c.id);
        return (
          <button key={c.id}
            className={`stats-cat-pill ${active === c.id ? "active" : ""}`}
            style={active === c.id ? { background: cat.bg, borderColor: cat.color + "44", color: cat.color } : {}}
            onClick={() => onChange(active === c.id ? "all" : c.id)}
          >{cat.emoji} {cat.label} · {c.count}</button>
        );
      })}
    </div>
  );
}

// ── Category Donut (from API) ──────────────────────────────

function CategoryDonutAPI({ categories }: { categories: CategoriesResponse | null }) {
  const data = (categories?.categories ?? []).map(c => ({ ...c, ...getCat(c.id) }));
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return <div style={{ color: "var(--stats-muted)", fontSize: 11, fontFamily: "var(--stats-mono)", textAlign: "center", padding: 8 }}>Sin datos</div>;

  return (
    <div className="stats-dist-list">
      {data.map(d => (
        <div key={d.id} className="stats-dist-row">
          <div className="stats-dist-dot" style={{ background: d.color }} />
          <span className="stats-dist-name">{d.label}</span>
          <span className="stats-dist-pct">{Math.round(d.count / total * 100)}%</span>
          <span className="stats-dist-count">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Hotspots List (from API) ───────────────────────────────

function HotspotsListAPI({ hotspots }: { hotspots: HotspotsResponse | null }) {
  const spots = hotspots?.hotspots.slice(0, 7) ?? [];
  const max = Math.max(1, spots[0]?.count ?? 1);

  if (spots.length === 0) return <div style={{ color: "var(--stats-muted)", fontSize: 11, fontFamily: "var(--stats-mono)", textAlign: "center", padding: 16 }}>Sin datos de ubicación</div>;

  return (
    <div className="stats-hotspots">
      {spots.map((h, i) => {
        const col = h.avg_urgency >= 3.5 ? "#ef4444" : h.avg_urgency >= 2.5 ? "#f97316" : "#22c55e";
        return (
          <div key={h.address} className="stats-hotspot-row">
            <span className="stats-hotspot-num">{i + 1}</span>
            <div className="stats-hotspot-content">
              <div className="stats-hotspot-header">
                <span className="stats-hotspot-name">{h.address}</span>
                <span className="stats-hotspot-count" style={{ color: col }}>{h.count}</span>
              </div>
              <div className="stats-hotspot-bar-bg">
                <div className="stats-hotspot-bar" style={{ width: `${(h.count / max) * 100}%`, background: `linear-gradient(90deg, ${col}44, ${col})` }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Activity by Time Slot ──────────────────────────────────

const TIME_SLOTS = [
  { label: "Madrugada", range: [0, 6],   icon: "🌙" },
  { label: "Mañana",    range: [6, 12],  icon: "☀️" },
  { label: "Tarde",     range: [12, 18], icon: "🌤" },
  { label: "Noche",     range: [18, 24], icon: "🌑" },
] as const;

function ActivityBySlot({ byHour }: { byHour: ByHourResponse | null }) {
  const slots = useMemo(() => {
    // Aggregate hourly data into 4 time slots
    const result = TIME_SLOTS.map(slot => {
      let total = 0;
      let urgSum = 0;
      if (byHour?.hours) {
        for (const h of byHour.hours) {
          if (h.hour >= slot.range[0] && h.hour < slot.range[1]) {
            total += h.count;
            urgSum += h.avg_urgency * h.count;
          }
        }
      } else if (byHour?.grid) {
        for (const b of byHour.grid) {
          if (b.hour >= slot.range[0] && b.hour < slot.range[1]) {
            total += b.count;
            urgSum += b.avg_urgency * b.count;
          }
        }
      }
      return {
        ...slot,
        total,
        avgUrg: total > 0 ? urgSum / total : 0,
      };
    });
    return result;
  }, [byHour]);

  const maxTotal = Math.max(1, ...slots.map(s => s.total));
  const grandTotal = slots.reduce((s, sl) => s + sl.total, 0);

  if (grandTotal === 0) return <div style={{ color: "var(--stats-muted)", fontSize: 11, fontFamily: "var(--stats-mono)", textAlign: "center", padding: 8 }}>Sin datos</div>;

  return (
    <div className="stats-slots">
      {slots.map(s => {
        const pct = Math.round((s.total / grandTotal) * 100);
        const barPct = (s.total / maxTotal) * 100;
        const urgCol = s.avgUrg >= 3.5 ? "#ef4444" : s.avgUrg >= 2.5 ? "#f97316" : s.avgUrg >= 1.5 ? "#eab308" : "#22c55e";
        return (
          <div key={s.label} className="stats-slot-row">
            <span className="stats-slot-icon">{s.icon}</span>
            <span className="stats-slot-label">{s.label}</span>
            <div className="stats-slot-bar-bg">
              <div className="stats-slot-bar" style={{ width: `${barPct}%`, background: `linear-gradient(90deg, ${urgCol}66, ${urgCol})` }} />
            </div>
            <span className="stats-slot-count">{s.total}</span>
            <span className="stats-slot-pct">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Narrative Line ───────────────────────────────────────

function NarrativeLine({ summary, hotspots, categories }: {
  summary: KPISummary | null;
  hotspots: HotspotsResponse | null;
  categories: CategoriesResponse | null;
}) {
  const text = useMemo(() => {
    if (!summary) return null;
    const parts: string[] = [];

    // Trend
    if (summary.delta_week_pct != null) {
      if (summary.delta_week_pct > 15) parts.push(`Semana activa: reportes subieron ${summary.delta_week_pct}%`);
      else if (summary.delta_week_pct < -15) parts.push(`Semana tranquila: reportes bajaron ${Math.abs(summary.delta_week_pct)}%`);
      else parts.push("Actividad estable esta semana");
    }

    // Top zone
    if (hotspots?.hotspots?.[0]) {
      parts.push(`Zona más activa: ${hotspots.hotspots[0].address}`);
    }

    // Urgency alert
    if (summary.avg_urgency >= 3.5) parts.push("⚠ Urgencia promedio alta");
    if (summary.pending >= 10) parts.push(`${summary.pending} reportes pendientes de clasificar`);

    return parts.join(" · ");
  }, [summary, hotspots, categories]);

  if (!text) return null;

  return (
    <div className="stats-narrative">
      {text}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function StatsDashboard() {
  const [rangeIdx, setRangeIdx] = useState(1); // default 30d
  const [activeCat, setActiveCat] = useState("all");
  const dateRange = RANGE_PRESETS[rangeIdx].range;

  const { data, loading, errors, refresh, lastUpdated } = useStatsData(dateRange);

  // Filter hotspots by category if one is selected
  const filteredHotspots = useMemo(() => {
    if (!data.hotspots || activeCat === "all") return data.hotspots;
    return {
      hotspots: data.hotspots.hotspots.filter(h => h.top_category === activeCat),
    };
  }, [data.hotspots, activeCat]);

  // Filter reports geo by category
  const filteredReportsGeo = useMemo(() => {
    if (!data.reportsGeo) return [];
    if (activeCat === "all") return data.reportsGeo.reports;
    return data.reportsGeo.reports.filter(r => r.category === activeCat);
  }, [data.reportsGeo, activeCat]);

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className="stats-dashboard">
      {/* Header */}
      <div className="stats-header">
        <div className="stats-header-left">
          <div className="stats-live-dot" />
          <span className="stats-header-brand">TALKATIVE</span>
          <span className="stats-header-badge">COMMUNITY SECURITY</span>
        </div>
        <div className="stats-header-right">
          <span>Cariló, Buenos Aires</span>

          {/* Range selector */}
          <div style={{ display: "flex", gap: 2 }}>
            {RANGE_PRESETS.map((p, i) => (
              <button key={p.label}
                className={`stats-cat-pill ${rangeIdx === i ? "active" : ""}`}
                style={{ padding: "3px 8px", minHeight: 0, fontSize: 9 }}
                onClick={() => setRangeIdx(i)}
              >{p.label}</button>
            ))}
          </div>

          {/* Export */}
          <button
            className="stats-cat-pill"
            style={{ padding: "3px 8px", minHeight: 0, fontSize: 9 }}
            onClick={() => downloadExport(dateRange).catch(err => alert(err.message))}
          >CSV ↓</button>

          <div className="stats-live-indicator">
            <div className="stats-live-dot small" />
            <span>{loading ? "..." : "LIVE"}</span>
          </div>
        </div>
      </div>

      <div className="stats-body">
        {/* Error banner */}
        {hasErrors && !loading && (
          <div style={{
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 8, padding: "8px 12px", fontSize: 11, fontFamily: "var(--stats-mono)",
            color: "#f87171", display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>⚠ No se pudo conectar al backend. ¿Está corriendo el servidor?</span>
            <button onClick={refresh} style={{
              background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 6, padding: "4px 10px", color: "#f87171", fontSize: 10,
              fontFamily: "var(--stats-mono)", cursor: "pointer", width: "auto",
            }}>Reintentar</button>
          </div>
        )}

        <NarrativeLine summary={data.summary} hotspots={data.hotspots} categories={data.categories} />

        <CategoryFilterAPI categories={data.categories} active={activeCat} onChange={setActiveCat} />

        {/* Main layout */}
        <div className="stats-layout">
          <div className="stats-map-col">
            <StatsMap reports={filteredReportsGeo} />
          </div>

          <div className="stats-panels-col">
            <KPIStripAPI summary={data.summary} />

            <div className="stats-card stats-card-donut">
              <div className="stats-card-title">DISTRIBUCIÓN</div>
              <CategoryDonutAPI categories={data.categories} />
            </div>

            <div className="stats-card stats-card-hotspots">
              <div className="stats-card-title">ZONAS RECURRENTES</div>
              <HotspotsListAPI hotspots={filteredHotspots} />
            </div>

            <div className="stats-card">
              <div className="stats-card-title">ACTIVIDAD POR FRANJA</div>
              <ActivityBySlot byHour={data.byHour} />
            </div>
          </div>
        </div>

        {/* Last updated */}
        {lastUpdated && (
          <div style={{ textAlign: "center", fontSize: 9, color: "var(--stats-dim)", fontFamily: "var(--stats-mono)" }}>
            Actualizado: {lastUpdated.toLocaleTimeString("es-AR")} · Auto-refresh cada 60s
          </div>
        )}
      </div>
    </div>
  );
}
