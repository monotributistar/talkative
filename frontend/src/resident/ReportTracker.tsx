import { useEffect, useState } from "react";
import { getReportStatus, ReportStatus } from "../api";

interface Props {
  reportId: string;
  onNewReport: () => void;
}

export default function ReportTracker({ reportId, onNewReport }: Props) {
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!reportId) return;
    let active = true;

    const poll = async () => {
      try {
        const data = await getReportStatus(reportId);
        if (active) {
          setStatus(data);
          if (data.status === "classified") setPolling(false);
        }
      } catch {
        // keep polling
      }
    };

    void poll();
    const timer = polling ? setInterval(poll, 4000) : undefined;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [reportId, polling]);

  const isPending = !status || status.status === "pending";
  const isClassified = status?.status === "classified";

  return (
    <div className="tracker">
      {/* Status indicator */}
      <div className="tracker-icon">
        {isPending && <div className="tracker-pulse">⏳</div>}
        {isClassified && <div className="tracker-done">✅</div>}
      </div>

      <h2 className="tracker-title">
        {isClassified ? "Reporte procesado" : "Reporte enviado"}
      </h2>

      <p className="tracker-message">
        {status?.message ?? "Tu reporte está siendo procesado..."}
      </p>

      {/* Classification detail card */}
      {isClassified && status?.classification && (
        <div className="tracker-result">
          <div className="tracker-result-header">
            <span className="tracker-routed-label">Derivado a</span>
            <span className="tracker-routed-value">
              {status.classification.routed_to.replace(/_/g, " ")}
            </span>
          </div>
          <div className="tracker-result-meta">
            <span>Categoría: {status.classification.category}</span>
            <span>Urgencia: {status.classification.urgency}/5</span>
          </div>
          <p className="tracker-result-summary">{status.classification.summary}</p>
        </div>
      )}

      {/* Timeline */}
      <div className="tracker-timeline">
        <div className="tracker-step completed">
          <div className="tracker-step-dot" />
          <div className="tracker-step-info">
            <span className="tracker-step-label">Recibido</span>
            {status?.submitted_at && (
              <span className="tracker-step-time">
                {new Date(status.submitted_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className={`tracker-step ${isClassified ? "completed" : "pending"}`}>
          <div className="tracker-step-dot" />
          <div className="tracker-step-info">
            <span className="tracker-step-label">Clasificado</span>
            {status?.classified_at && (
              <span className="tracker-step-time">
                {new Date(status.classified_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className={`tracker-step ${isClassified ? "completed" : "future"}`}>
          <div className="tracker-step-dot" />
          <div className="tracker-step-info">
            <span className="tracker-step-label">Derivado</span>
          </div>
        </div>
      </div>

      {polling && (
        <p className="tracker-polling">Actualizando estado automáticamente...</p>
      )}

      <div className="tracker-actions">
        <button className="report-submit" onClick={onNewReport}>
          Enviar otro reporte
        </button>
        {reportId && (
          <button
            className="tracker-share"
            onClick={() => {
              const url = `${window.location.origin}/estado/${reportId}`;
              if (navigator.share) {
                navigator.share({ title: "Estado de reporte", url });
              } else {
                navigator.clipboard.writeText(url);
              }
            }}
          >
            📋 Copiar link de seguimiento
          </button>
        )}
      </div>
    </div>
  );
}
