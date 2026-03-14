import { useEffect, useState } from "react";
import ReportForm from "./ReportForm";
import ReportTracker from "./ReportTracker";
import { validateCommunityCode } from "../api";

type View = "gate" | "report" | "tracking";

function CodeGate({ onValidated }: { onValidated: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setChecking(true);
    setError("");
    try {
      const result = await validateCommunityCode(code.trim());
      if (result.ok) onValidated();
    } catch (err) {
      setError((err as Error).message || "Código inválido");
    }
    setChecking(false);
  }

  return (
    <div className="gate">
      <div className="gate-icon">🛡️</div>
      <h2 className="gate-title">Seguridad Cariló</h2>
      <p className="gate-desc">Ingresá el código de tu comunidad para acceder</p>
      <form className="gate-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Código de comunidad"
          className="gate-input"
          autoFocus
          autoComplete="off"
        />
        <button type="submit" className="report-submit" disabled={!code.trim() || checking}>
          {checking ? "Verificando..." : "Ingresar"}
        </button>
        {error && <p className="report-error">{error}</p>}
      </form>
      <p className="gate-help">
        ¿No tenés el código? Contactá a la administración de tu barrio.
      </p>
    </div>
  );
}

export default function ResidentApp() {
  const [view, setView] = useState<View>("gate");
  const [reportId, setReportId] = useState<string | null>(null);
  const [dark, setDark] = useState(() => {
    const h = new Date().getHours();
    const prefersDark = h >= 20 || h < 7;
    const saved = localStorage.getItem("resident-theme");
    return saved ? saved === "dark" : prefersDark;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("resident-theme", dark ? "dark" : "light");
  }, [dark]);

  // Check if already has community code
  useEffect(() => {
    const hasCode = !!localStorage.getItem("community-code");
    if (hasCode) {
      // Check URL for tracking
      const match = window.location.pathname.match(/\/estado\/(.+)/);
      if (match) {
        setReportId(match[1]);
        setView("tracking");
      } else {
        setView("report");
      }
    } else {
      // Even without code, allow tracking by URL (public endpoint)
      const match = window.location.pathname.match(/\/estado\/(.+)/);
      if (match) {
        setReportId(match[1]);
        setView("tracking");
      }
    }
  }, []);

  function handleReportSent(id: string) {
    setReportId(id);
    setView("tracking");
    window.history.replaceState({}, "", `/estado/${id}`);
  }

  function handleNewReport() {
    setReportId(null);
    setView("report");
    window.history.replaceState({}, "", "/");
  }

  return (
    <div className="resident-app">
      <header className="resident-app-header">
        <div className="resident-app-brand">
          <span className="resident-app-logo">🛡️</span>
          <span className="resident-app-title">Seguridad Cariló</span>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setDark((d) => !d)}
          aria-label={dark ? "Modo claro" : "Modo nocturno"}
        >
          {dark ? "☀️" : "🌙"}
        </button>
      </header>

      <main className="resident-app-main">
        {view === "gate" && (
          <CodeGate onValidated={() => setView("report")} />
        )}
        {view === "report" && (
          <ReportForm onSent={handleReportSent} />
        )}
        {view === "tracking" && reportId && (
          <ReportTracker reportId={reportId} onNewReport={handleNewReport} />
        )}
      </main>

      <footer className="resident-app-footer">
        <p>Talkative Community · Cariló, Buenos Aires</p>
      </footer>
    </div>
  );
}
