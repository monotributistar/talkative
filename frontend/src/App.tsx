import { useEffect, useState } from "react";
import MissionControl from "./MissionControl";
import RouterAdmin from "./RouterAdmin";
import WorkflowEditor from "./WorkflowEditor";
import CommunityDashboard from "./CommunityDashboard";

type View = "mission" | "workflow" | "router-admin" | "dashboard";

function resolveInitialView(): View {
  const pathname = window.location.pathname;
  if (pathname === "/router-admin") return "router-admin";
  if (pathname === "/workflow") return "workflow";

  if (pathname === "/dashboard") return "dashboard";
  return "mission";
}

export default function App() {
  const [view, setView] = useState<View>(resolveInitialView);
  const [dark, setDark] = useState(() => {
    return document.documentElement.getAttribute("data-theme") === "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  function setViewWithPath(next: View) {
    setView(next);
    const pathMap: Record<View, string> = {
      mission: "/",
      workflow: "/workflow",
      "router-admin": "/router-admin",
      dashboard: "/dashboard",
    };
    window.history.replaceState({}, "", pathMap[next]);
  }

  return (
    <div className="app-shell">
      <header className="header-row">
        <h1>
          {view === "dashboard"
            ? "📊 Panel de Seguridad"
            : "Conversational Workflow Agent POC"}
        </h1>
        <div className="nav-tabs">
          <button
            className="theme-toggle"
            onClick={() => setDark((d) => !d)}
            title={dark ? "Modo claro" : "Modo nocturno"}
          >
            {dark ? "☀️" : "🌙"}
          </button>
          <button className={view === "mission" ? "tab active" : "tab"} onClick={() => setViewWithPath("mission")}>
            Mission Control
          </button>
          <button className={view === "workflow" ? "tab active" : "tab"} onClick={() => setViewWithPath("workflow")}>
            Workflow
          </button>
          <button className={view === "router-admin" ? "tab active" : "tab"} onClick={() => setViewWithPath("router-admin")}>
            Router
          </button>
          <button className={view === "dashboard" ? "tab active tab-community" : "tab tab-community"} onClick={() => setViewWithPath("dashboard")}>
            📊 Dashboard
          </button>
        </div>
      </header>

      {view === "mission" && <MissionControl />}
      {view === "workflow" && <WorkflowEditor />}
      {view === "router-admin" && <RouterAdmin />}
      {view === "dashboard" && <CommunityDashboard />}
    </div>
  );
}
