import { FormEvent, useEffect, useRef, useState } from "react";
import { submitCommunityReport, getReportStatus, ReportStatus } from "./api";

const CATEGORY_HINTS = [
  { emoji: "🚨", label: "Seguridad", hint: "Robo, persona sospechosa, vandalismo..." },
  { emoji: "🔥", label: "Incendio / Humo", hint: "Fuego, olor a quemado, fogata..." },
  { emoji: "🚧", label: "Calle / Infraestructura", hint: "Bache, sin luz, árbol caído..." },
  { emoji: "🏗️", label: "Construcción irregular", hint: "Obra sin permiso, ruidos de obra..." },
  { emoji: "📢", label: "Convivencia", hint: "Música fuerte, perro suelto, basura..." },
  { emoji: "📋", label: "Consulta / Otro", hint: "Ordenanzas, permisos, dudas..." },
];

interface PhotoFile {
  name: string;
  dataUrl: string;
}

function PhotoUpload({
  photos,
  onAdd,
  onRemove,
}: {
  photos: PhotoFile[];
  onAdd: (p: PhotoFile) => void;
  onRemove: (i: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = (ev) => {
        onAdd({ name: file.name, dataUrl: ev.target?.result as string });
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        onChange={handleFiles}
        style={{ display: "none" }}
      />
      <div className="photo-upload">
        {photos.map((p, i) => (
          <div key={i} className="photo-thumb">
            <img src={p.dataUrl} alt={p.name} />
            <button className="photo-remove" onClick={() => onRemove(i)}>
              ✕
            </button>
          </div>
        ))}
        {photos.length < 4 && (
          <button
            type="button"
            className="photo-add-btn"
            onClick={() => fileRef.current?.click()}
          >
            <span style={{ fontSize: "1.3rem" }}>📷</span>
            <span>Foto</span>
          </button>
        )}
      </div>
      {photos.length > 0 && (
        <p className="photo-count">
          {photos.length}/4 foto{photos.length !== 1 ? "s" : ""} adjunta
          {photos.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

function ReportTracker({ reportId, onDone }: { reportId: string; onDone: () => void }) {
  const [rs, setRs] = useState<ReportStatus | null>(null);
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    const poll = async () => {
      try {
        const data = await getReportStatus(reportId);
        if (active) {
          setRs(data);
          if (data.status === "classified") setPolling(false);
        }
      } catch {
        // ignore — keep polling
      }
    };
    void poll();
    const timer = polling ? setInterval(poll, 4000) : undefined;
    return () => { active = false; if (timer) clearInterval(timer); };
  }, [reportId, polling]);

  return (
    <div style={{ textAlign: "center", padding: "32px 16px", maxWidth: 420, margin: "0 auto" }}>
      <div style={{ fontSize: "3rem", marginBottom: 12 }}>
        {rs?.status === "classified" ? "✅" : "⏳"}
      </div>
      <h2 style={{ margin: "0 0 8px" }}>
        {rs?.status === "classified" ? "Reporte procesado" : "Reporte enviado"}
      </h2>
      <p className="muted" style={{ fontSize: "0.92rem", marginBottom: 16 }}>
        {rs?.message ?? "Tu reporte está siendo procesado..."}
      </p>

      {rs?.classification && (
        <div className="card" style={{ textAlign: "left", padding: 14, marginBottom: 16 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Derivado a: {rs.classification.routed_to.replace(/_/g, " ")}</p>
          <p className="muted" style={{ margin: "0 0 4px", fontSize: "0.88rem" }}>
            Categoría: {rs.classification.category} — Urgencia: {rs.classification.urgency}/5
          </p>
          <p style={{ margin: 0, fontSize: "0.88rem" }}>{rs.classification.summary}</p>
        </div>
      )}

      {polling && <p className="muted" style={{ fontSize: "0.8rem" }}>Consultando estado cada unos segundos...</p>}

      <button
        className="resident-submit"
        style={{ marginTop: 12 }}
        onClick={onDone}
      >
        Enviar otro reporte
      </button>
    </div>
  );
}

export default function ResidentReport() {
  const [text, setText] = useState("");
  const [addressHint, setAddressHint] = useState("");
  const [selectedHint, setSelectedHint] = useState<number | null>(null);
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [feedbackMsg, setFeedbackMsg] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;

    setStatus("sending");
    try {
      const prefix = selectedHint !== null ? `[${CATEGORY_HINTS[selectedHint].label}] ` : "";
      const result = await submitCommunityReport({
        text: prefix + text.trim(),
        location: addressHint.trim() ? { address_hint: addressHint.trim() } : undefined,
      });
      setFeedbackMsg(result.report_id);
      setStatus("sent");
      setText("");
      setAddressHint("");
      setSelectedHint(null);
      setPhotos([]);
      setTimeout(() => {
        setStatus("idle");
        setFeedbackMsg("");
      }, 4000);
    } catch (err) {
      setStatus("error");
      setFeedbackMsg((err as Error).message);
    }
  }

  if (status === "sent") {
    return (
      <div className="resident-container">
        <ReportTracker reportId={feedbackMsg} onDone={() => { setStatus("idle"); setFeedbackMsg(""); }} />
      </div>
    );
  }

  return (
    <div className="resident-container">
      <div className="resident-header">
        <h2>📍 Reportar incidente</h2>
        <p className="resident-subtitle">Tu reporte ayuda a mantener seguro el barrio</p>
      </div>

      <form className="resident-form" onSubmit={onSubmit}>
        <div className="category-chips">
          {CATEGORY_HINTS.map((cat, i) => (
            <button
              key={i}
              type="button"
              className={`chip ${selectedHint === i ? "chip-active" : ""}`}
              onClick={() => setSelectedHint(selectedHint === i ? null : i)}
            >
              <span className="chip-emoji">{cat.emoji}</span>
              <span className="chip-label">{cat.label}</span>
            </button>
          ))}
        </div>

        {selectedHint !== null && (
          <p className="hint-text">{CATEGORY_HINTS[selectedHint].hint}</p>
        )}

        <textarea
          className="resident-textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Contanos qué está pasando..."
        />

        <PhotoUpload
          photos={photos}
          onAdd={(p) => setPhotos((prev) => (prev.length < 4 ? [...prev, p] : prev))}
          onRemove={(i) => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
        />

        <input
          className="resident-input"
          type="text"
          value={addressHint}
          onChange={(e) => setAddressHint(e.target.value)}
          placeholder="📍 Ubicación aproximada (calle, esquina...)"
        />

        <button
          type="submit"
          className="resident-submit"
          disabled={!text.trim() || status === "sending"}
        >
          {status === "sending"
            ? "Enviando..."
            : `Enviar reporte${photos.length > 0 ? ` (${photos.length} 📷)` : ""}`}
        </button>

        {status === "error" && <p className="resident-error">{feedbackMsg}</p>}
      </form>
    </div>
  );
}
