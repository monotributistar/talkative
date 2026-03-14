import { useEffect, useState } from "react";
import {
  CommunityDashboard as DashboardData,
  getCommunityDashboard,
  triggerClassification,
  operatorLogin,
  generateWeeklySummary,
  getIncidents,
  getSuggestions,
  confirmSuggestion,
  dismissSuggestion,
  updateIncidentStatus,
  createIncident,
} from "./api";
import type { Incident, IncidentSuggestion, IncidentStatus } from "./api";

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

// ── Status helpers ────────────────────────────────────────

const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "Abierto",
  in_progress: "En proceso",
  resolved: "Resuelto",
  closed: "Cerrado",
  re_opened: "Reabierto",
};

const STATUS_COLOR: Record<IncidentStatus, string> = {
  open: "#e74c3c",
  in_progress: "#e67e22",
  resolved: "#2ecc71",
  closed: "#888",
  re_opened: "#f1c40f",
};

// ── Incidents Panel ────────────────────────────────────────

function IncidentsPanel() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [suggestions, setSuggestions] = useState<IncidentSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("seguridad");
  const [newZone, setNewZone] = useState("");
  const [creating, setCreating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<IncidentStatus | "all">("all");

  async function load() {
    setLoading(true);
    try {
      const [inc, sug] = await Promise.all([getIncidents(), getSuggestions()]);
      setIncidents(inc.incidents);
      setSuggestions(sug.suggestions);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function handleStatusChange(id: string, status: IncidentStatus) {
    let note: string | undefined;
    if (status === "resolved") note = prompt("Nota de resolución (opcional):") ?? undefined;
    await updateIncidentStatus(id, status, note);
    setSelected(null);
    void load();
  }

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await createIncident({ title: newTitle.trim(), category: newCategory, zone: newZone.trim() || undefined });
      setNewTitle(""); setNewCategory("seguridad"); setNewZone("");
      setShowCreate(false);
      void load();
    } finally { setCreating(false); }
  }

  const filtered = filterStatus === "all" ? incidents : incidents.filter(i => i.status === filterStatus);

  if (loading) return <div className="dash-loading">Cargando incidentes...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {suggestions.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid #f1c40f", padding: 16 }}>
          <h3 style={{ marginBottom: 12 }}>⚠️ {suggestions.length} sugerencia{suggestions.length > 1 ? "s" : ""} del clasificador</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {suggestions.map(s => (
              <div key={s.report_id} style={{ background: "var(--color-bg-secondary,#1a1a2e)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: "0.85rem" }}>{s.report_summary || s.report_text.slice(0, 100)}</div>
                <div style={{ fontSize: "0.8rem", color: "#f1c40f", marginTop: 4 }}>
                  Sugiere vincular al incidente <strong>…{s.suggestion.incident_id.slice(-6)}</strong> — {Math.round(s.suggestion.confidence * 100)}% confianza
                </div>
                <div style={{ fontSize: "0.75rem", opacity: 0.7, marginTop: 2 }}>{s.suggestion.reasoning}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => { confirmSuggestion(s.report_id).then(load); }}
                    style={{ padding: "4px 12px", borderRadius: 6, background: "#2ecc71", color: "#000", border: "none", cursor: "pointer", fontSize: "0.8rem" }}>✓ Confirmar</button>
                  <button onClick={() => { dismissSuggestion(s.report_id).then(load); }}
                    style={{ padding: "4px 12px", borderRadius: 6, background: "transparent", color: "var(--color-text)", border: "1px solid #555", cursor: "pointer", fontSize: "0.8rem" }}>✕ Descartar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["all", "open", "in_progress", "resolved", "closed"] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} style={{
              padding: "4px 12px", borderRadius: 20, border: "1px solid", fontSize: "0.8rem", cursor: "pointer",
              borderColor: filterStatus === s ? (s === "all" ? "#888" : STATUS_COLOR[s]) : "#444",
              background: filterStatus === s ? "rgba(255,255,255,0.05)" : "transparent",
              color: filterStatus === s && s !== "all" ? STATUS_COLOR[s] : "var(--color-text)",
            }}>
              {s === "all" ? "Todos" : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="classify-btn" style={{ padding: "6px 16px", fontSize: "0.85rem" }}>
          + Nuevo incidente
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <h4 style={{ margin: 0 }}>Crear incidente manualmente</h4>
          <input placeholder="Título" value={newTitle} onChange={e => setNewTitle(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #444", background: "var(--color-input-bg,#1a1a2e)", color: "var(--color-text)", fontSize: "0.9rem" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
              style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #444", background: "var(--color-input-bg,#1a1a2e)", color: "var(--color-text)", fontSize: "0.9rem" }}>
              {["seguridad","bomberos","municipal","fiscalizacion","vialidad","convivencia"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input placeholder="Zona (opcional)" value={newZone} onChange={e => setNewZone(e.target.value)}
              style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #444", background: "var(--color-input-bg,#1a1a2e)", color: "var(--color-text)", fontSize: "0.9rem" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleCreate} disabled={!newTitle.trim() || creating} className="classify-btn" style={{ flex: 1 }}>{creating ? "Creando..." : "Crear"}</button>
            <button onClick={() => setShowCreate(false)} style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #444", background: "transparent", color: "var(--color-text)", cursor: "pointer" }}>Cancelar</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: "center" }}>
          <p className="muted">No hay incidentes {filterStatus !== "all" ? `con estado "${STATUS_LABEL[filterStatus]}"` : "registrados"}.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(incident => (
            <div key={incident.id} className="card"
              style={{ padding: 14, cursor: "pointer", borderLeft: `4px solid ${STATUS_COLOR[incident.status]}` }}
              onClick={() => setSelected(selected === incident.id ? null : incident.id)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{incident.title}</span>
                  <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: 2 }}>
                    {CATEGORY_EMOJI[incident.category] ?? "📌"} {incident.category}
                    {incident.zone && <span> · {incident.zone}</span>}
                    {incident.report_count != null && <span> · {incident.report_count} reporte{incident.report_count !== 1 ? "s" : ""}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: 10, background: `${STATUS_COLOR[incident.status]}22`, color: STATUS_COLOR[incident.status], fontWeight: 600 }}>
                    {STATUS_LABEL[incident.status]}
                  </span>
                  <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>
                    {new Date(incident.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              {selected === incident.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #333", display: "flex", flexWrap: "wrap", gap: 6 }}
                  onClick={e => e.stopPropagation()}>
                  {incident.status === "open" && (
                    <button onClick={() => handleStatusChange(incident.id, "in_progress")}
                      style={{ padding: "4px 10px", borderRadius: 6, background: "#e67e2222", color: "#e67e22", border: "1px solid #e67e22", cursor: "pointer", fontSize: "0.8rem" }}>→ En proceso</button>
                  )}
                  {["open","in_progress","re_opened"].includes(incident.status) && (
                    <button onClick={() => handleStatusChange(incident.id, "resolved")}
                      style={{ padding: "4px 10px", borderRadius: 6, background: "#2ecc7122", color: "#2ecc71", border: "1px solid #2ecc71", cursor: "pointer", fontSize: "0.8rem" }}>✓ Resolver</button>
                  )}
                  {incident.status === "resolved" && (
                    <button onClick={() => handleStatusChange(incident.id, "closed")}
                      style={{ padding: "4px 10px", borderRadius: 6, background: "#88888822", color: "#888", border: "1px solid #888", cursor: "pointer", fontSize: "0.8rem" }}>Cerrar</button>
                  )}
                  {incident.resolution_note && (
                    <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", alignSelf: "center" }}>📝 {incident.resolution_note}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<"reportes" | "incidentes">("reportes");

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

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #333", marginBottom: 8 }}>
        {(["reportes", "incidentes"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: "8px 20px", background: "transparent", border: "none",
            borderBottom: activeTab === tab ? "2px solid #e74c3c" : "2px solid transparent",
            color: activeTab === tab ? "var(--color-text)" : "var(--color-text-muted)",
            cursor: "pointer", fontSize: "0.9rem", fontWeight: activeTab === tab ? 600 : 400,
            textTransform: "capitalize",
          }}>
            {tab === "reportes" ? "📋 Reportes" : "🚨 Incidentes"}
          </button>
        ))}
      </div>

      {activeTab === "incidentes" && <IncidentsPanel />}

      {activeTab === "reportes" && <>

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

      </>}
    </div>
  );
}
