import { useEffect, useState } from "react";
import {
  CommunityDashboard as DashboardData,
  getCommunityDashboard,
  triggerClassification,
  operatorLogin,
  generateWeeklySummary,
} from "./api";

// ── Operator Login Gate ────────────────────────────────────

function OperatorLoginGate({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setChecking(true);
    setError("");
    try {
      const result = await operatorLogin(password);
      if (result.ok) onLoggedIn();
    } catch (err) {
      setError((err as Error).message || "Contraseña incorrecta");
    }
    setChecking(false);
  }

  return (
    <div style={{ maxWidth: 400, margin: "80px auto", textAlign: "center" }}>
      <h2>🔒 Panel de Operador</h2>
      <p className="muted">Ingresá la contraseña de administración</p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          autoFocus
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            border: "1px solid var(--color-border, #333)",
            background: "var(--color-input-bg, #1a1a2e)",
            color: "var(--color-text, #e0e0e0)",
            fontSize: "1rem",
          }}
        />
        <button
          type="submit"
          className="classify-btn"
          disabled={!password.trim() || checking}
        >
          {checking ? "Verificando..." : "Ingresar"}
        </button>
        {error && <p style={{ color: "#e74c3c", marginTop: 8 }}>{error}</p>}
      </form>
    </div>
  );
}

// ── Heatmap Preview ────────────────────────────────────────

interface HeatmapProps {
  items: Array<{ location_normalized: string | null; urgency: number }>;
}

function HeatmapPreview({ items }: HeatmapProps) {
  // Aggregate by location
  const locations = new Map<string, { count: number; maxUrgency: number }>();
  for (const item of items) {
    const loc = item.location_normalized?.trim();
    if (!loc) continue;
    const existing = locations.get(loc);
    if (existing) {
      existing.count++;
      existing.maxUrgency = Math.max(existing.maxUrgency, item.urgency);
    } else {
      locations.set(loc, { count: 1, maxUrgency: item.urgency });
    }
  }

  const sorted = [...locations.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  const maxCount = sorted.length > 0 ? sorted[0][1].count : 1;

  if (sorted.length === 0) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <h3>Mapa de calor</h3>
        <p className="muted">Sin datos de ubicación. Los reportes necesitan dirección para visualizarse.</p>
      </div>
    );
  }

  function urgencyColor(u: number): string {
    if (u >= 5) return "#e74c3c";
    if (u >= 4) return "#e67e22";
    if (u >= 3) return "#f1c40f";
    return "#2ecc71";
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3>Zonas calientes</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {sorted.map(([loc, data]) => {
          const pct = Math.round((data.count / maxCount) * 100);
          return (
            <div key={loc} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ minWidth: 160, fontSize: "0.85rem", color: "var(--color-text)" }}>
                {loc}
              </span>
              <div style={{
                flex: 1,
                height: 22,
                borderRadius: 6,
                background: "var(--color-bg-secondary, #1a1a2e)",
                overflow: "hidden",
                position: "relative",
              }}>
                <div style={{
                  width: `${pct}%`,
                  height: "100%",
                  borderRadius: 6,
                  background: `${urgencyColor(data.maxUrgency)}cc`,
                  transition: "width 0.5s ease",
                  minWidth: 20,
                }} />
                <span style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "0.75rem",
                  color: "var(--color-text)",
                  fontWeight: 600,
                }}>
                  {data.count}
                </span>
              </div>
              <span style={{ fontSize: "0.7rem", opacity: 0.7 }}>
                urg {data.maxUrgency}
              </span>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: "0.75rem", marginTop: 10 }}>
        Basado en {items.filter(i => i.location_normalized).length} reportes con ubicación
      </p>
    </div>
  );
}

// ── Constants ──────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  seguridad: "#e74c3c",
  bomberos: "#e67e22",
  municipal: "#3498db",
  fiscalizacion: "#9b59b6",
  vialidad: "#f39c12",
  convivencia: "#2ecc71",
};

const CATEGORY_EMOJI: Record<string, string> = {
  seguridad: "🚨",
  bomberos: "🔥",
  municipal: "📋",
  fiscalizacion: "🏗️",
  vialidad: "🚧",
  convivencia: "📢",
};

function urgencyLabel(u: number): string {
  if (u >= 5) return "EMERGENCIA";
  if (u >= 4) return "ALTA";
  if (u >= 3) return "MEDIA";
  if (u >= 2) return "BAJA";
  return "INFO";
}

function urgencyClass(u: number): string {
  if (u >= 5) return "urg-emergency";
  if (u >= 4) return "urg-high";
  if (u >= 3) return "urg-medium";
  return "urg-low";
}

// ── Main Dashboard ─────────────────────────────────────────

export default function CommunityDashboard() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [classifyMsg, setClassifyMsg] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterUrgency, setFilterUrgency] = useState(0);
  const [generatingSummary, setGeneratingSummary] = useState(false);

  // Check if already has token
  useEffect(() => {
    const token = localStorage.getItem("operator-token");
    if (token) setLoggedIn(true);
  }, []);

  async function refresh() {
    try {
      const d = await getCommunityDashboard();
      setData(d);
    } catch (err) {
      // If 401, force re-login
      if ((err as Error).message?.includes("no autorizado") || (err as Error).message?.includes("Acceso")) {
        localStorage.removeItem("operator-token");
        setLoggedIn(false);
      }
      console.error("Dashboard fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!loggedIn) return;
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [loggedIn]);

  async function onClassify() {
    setClassifying(true);
    setClassifyMsg("");
    try {
      const result = await triggerClassification();
      setClassifyMsg(result.response);
      setTimeout(refresh, 2000);
    } catch (err) {
      setClassifyMsg(`Error: ${(err as Error).message}`);
    } finally {
      setClassifying(false);
    }
  }

  async function onGenerateSummary() {
    setGeneratingSummary(true);
    try {
      await generateWeeklySummary();
      alert("Resumen semanal generado");
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
    setGeneratingSummary(false);
  }

  if (!loggedIn) {
    return <OperatorLoginGate onLoggedIn={() => { setLoggedIn(true); setLoading(true); }} />;
  }

  if (loading) {
    return <div className="dash-loading">Cargando dashboard...</div>;
  }

  if (!data) {
    return (
      <div className="dash-loading">
        No hay datos disponibles. Creá un agente community-classifier primero.
      </div>
    );
  }

  const totalReports = Object.values(data.totals).reduce((a, b) => a + b, 0);
  const routingEntries = Object.entries(data.routing_summary).sort(
    (a, b) => b[1].highest_urgency - a[1].highest_urgency
  );

  const filteredItems = data.recent_items.filter((item) => {
    if (filterCategory !== "all" && item.category !== filterCategory) return false;
    if (filterUrgency > 0 && item.urgency < filterUrgency) return false;
    return true;
  });

  return (
    <div className="dash-container">
      {/* Logout button (title already in App.tsx header) */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button
          onClick={() => { localStorage.removeItem("operator-token"); setLoggedIn(false); }}
          style={{ background: "none", border: "1px solid var(--color-border, #333)", borderRadius: 6, padding: "6px 12px", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "0.8rem" }}
        >
          Cerrar sesión
        </button>
      </div>

      {/* Metric cards */}
      <div className="dash-metrics-row">
        <div className="dash-metric-card">
          <div className="metric-value">{data.reports_today}</div>
          <div className="metric-label">Reportes hoy</div>
        </div>
        <div className="dash-metric-card">
          <div className="metric-value">{data.reports_this_week}</div>
          <div className="metric-label">Esta semana</div>
        </div>
        <div className="dash-metric-card">
          <div className="metric-value accent">{data.pending_count}</div>
          <div className="metric-label">Pendientes</div>
        </div>
        <div className="dash-metric-card">
          <div className="metric-value">{totalReports}</div>
          <div className="metric-label">Clasificados</div>
        </div>
      </div>

      {/* Actions */}
      <div className="dash-actions">
        <button
          className="classify-btn"
          onClick={onClassify}
          disabled={classifying || data.pending_count === 0}
        >
          {classifying
            ? "Clasificando..."
            : `Clasificar ${data.pending_count} pendientes`}
        </button>
        <button
          className="classify-btn"
          onClick={onGenerateSummary}
          disabled={generatingSummary}
          style={{ background: "var(--color-bg-secondary, #1a1a2e)" }}
        >
          {generatingSummary ? "Generando..." : "Resumen semanal"}
        </button>
        {data.last_classification_at && (
          <span className="muted">
            Última clasificación:{" "}
            {new Date(data.last_classification_at).toLocaleString()}
          </span>
        )}
        {classifyMsg && <span className="dash-classify-msg">{classifyMsg}</span>}
      </div>

      {/* Heatmap */}
      <HeatmapPreview items={data.recent_items} />

      <div className="dash-grid">
        {/* Routing summary */}
        <div className="card dash-routing">
          <h3>Distribución por destinatario</h3>
          {routingEntries.length === 0 && <p className="muted">Sin datos aún</p>}
          {routingEntries.map(([routeId, route]) => (
            <div key={routeId} className="route-row">
              <div className="route-header">
                <span className="route-label">
                  {route.notify ? "🔔" : "📋"} {route.label}
                </span>
                <span className={`route-urgency ${urgencyClass(route.highest_urgency)}`}>
                  {urgencyLabel(route.highest_urgency)}
                </span>
              </div>
              <div className="route-bar-container">
                <div
                  className="route-bar"
                  style={{
                    width: `${totalReports > 0 ? (route.count / totalReports) * 100 : 0}%`,
                    background: CATEGORY_COLORS[routeId] ?? "#888",
                  }}
                />
                <span className="route-count">{route.count}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Category breakdown */}
        <div className="card dash-categories">
          <h3>Por categoría</h3>
          {Object.entries(data.totals).length === 0 && (
            <p className="muted">Sin datos aún</p>
          )}
          <div className="cat-grid">
            {Object.entries(data.totals).map(([catId, count]) => (
              <div
                key={catId}
                className="cat-chip"
                style={{
                  borderColor: CATEGORY_COLORS[catId] ?? "#888",
                  outline:
                    filterCategory === catId
                      ? `2px solid ${CATEGORY_COLORS[catId]}`
                      : "none",
                }}
                onClick={() =>
                  setFilterCategory(filterCategory === catId ? "all" : catId)
                }
              >
                <span className="cat-emoji">
                  {CATEGORY_EMOJI[catId] ?? "📌"}
                </span>
                <span className="cat-name">{catId}</span>
                <span className="cat-count">{count}</span>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: 16 }}>Urgencia mínima</h3>
          <div className="category-chips">
            {[0, 2, 3, 4, 5].map((u) => (
              <button
                key={u}
                type="button"
                className={`chip ${filterUrgency === u ? "chip-active" : ""}`}
                onClick={() => setFilterUrgency(u)}
              >
                <span className="chip-label">
                  {u === 0 ? "Todas" : `≥ ${u}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="card dash-feed">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <h3>
            Últimos reportes clasificados
            {filterCategory !== "all" && (
              <span className="muted"> — {filterCategory}</span>
            )}
          </h3>
          <span className="muted">
            {filteredItems.length} de {data.recent_items.length}
          </span>
        </div>
        <div className="feed-list">
          {filteredItems.length === 0 && (
            <p className="muted" style={{ textAlign: "center", padding: 20 }}>
              No hay reportes con estos filtros
            </p>
          )}
          {filteredItems.map((item) => (
            <div
              key={item.report_id}
              className={`feed-item ${urgencyClass(item.urgency)}`}
            >
              <div className="feed-top">
                <span className="feed-category">
                  {CATEGORY_EMOJI[item.category] ?? "📌"} {item.category}/
                  {item.subcategory}
                </span>
                <span
                  className={`feed-urgency ${urgencyClass(item.urgency)}`}
                >
                  {urgencyLabel(item.urgency)}
                </span>
              </div>
              <div className="feed-summary">{item.summary}</div>
              <div className="feed-meta">
                {item.location_normalized && (
                  <span className="feed-location">
                    {item.location_normalized}
                  </span>
                )}
                <span className="feed-route">→ {item.routed_to}</span>
                <span className="feed-confidence">
                  {Math.round(item.confidence * 100)}% confianza
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
