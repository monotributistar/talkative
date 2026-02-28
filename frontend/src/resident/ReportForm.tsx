import { FormEvent, useRef, useState } from "react";
import { submitCommunityReport, uploadReportPhotos } from "../api";

const CATEGORIES = [
  { emoji: "🚨", label: "Seguridad", hint: "Robo, persona sospechosa, vandalismo..." },
  { emoji: "🔥", label: "Incendio / Humo", hint: "Fuego, olor a quemado, fogata..." },
  { emoji: "🚧", label: "Calle / Infraestructura", hint: "Bache, sin luz, árbol caído..." },
  { emoji: "🏗️", label: "Construcción irregular", hint: "Obra sin permiso, ruidos de obra..." },
  { emoji: "📢", label: "Convivencia", hint: "Música fuerte, perro suelto, basura..." },
  { emoji: "📋", label: "Consulta / Otro", hint: "Ordenanzas, permisos, dudas..." },
];

function PhotoUpload({
  photos,
  onAdd,
  onRemove,
}: {
  photos: File[];
  onAdd: (f: File) => void;
  onRemove: (i: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPreviews((prev) => [...prev, ev.target?.result as string]);
      };
      reader.readAsDataURL(file);
      onAdd(file);
    }
    e.target.value = "";
  }

  function handleRemove(i: number) {
    setPreviews((prev) => prev.filter((_, idx) => idx !== i));
    onRemove(i);
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
        {previews.map((src, i) => (
          <div key={i} className="photo-thumb">
            <img src={src} alt={`foto-${i + 1}`} />
            <button className="photo-remove" onClick={() => handleRemove(i)}>✕</button>
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
          {photos.length}/4 foto{photos.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

interface Props {
  onSent: (reportId: string) => void;
}

export default function ReportForm({ onSent }: Props) {
  const [text, setText] = useState("");
  const [address, setAddress] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;

    setSending(true);
    setError("");
    try {
      const prefix = selected !== null ? `[${CATEGORIES[selected].label}] ` : "";
      const result = await submitCommunityReport({
        text: prefix + text.trim(),
        location: address.trim() ? { address_hint: address.trim() } : undefined,
      });

      // Upload photos if any
      if (photos.length > 0) {
        try {
          await uploadReportPhotos(result.report_id, photos);
        } catch {
          // Photos are best-effort, don't block the report
          console.warn("Photo upload failed, report was still submitted");
        }
      }

      onSent(result.report_id);
    } catch (err) {
      setError((err as Error).message);
      setSending(false);
    }
  }

  return (
    <div className="report-form-container">
      <div className="report-form-header">
        <h2>Reportar incidente</h2>
        <p>Tu reporte ayuda a mantener seguro el barrio</p>
      </div>

      <form className="report-form" onSubmit={onSubmit}>
        <div className="category-chips">
          {CATEGORIES.map((cat, i) => (
            <button
              key={i}
              type="button"
              className={`chip ${selected === i ? "chip-active" : ""}`}
              onClick={() => setSelected(selected === i ? null : i)}
            >
              <span className="chip-emoji">{cat.emoji}</span>
              <span className="chip-label">{cat.label}</span>
            </button>
          ))}
        </div>

        {selected !== null && (
          <p className="hint-text">{CATEGORIES[selected].hint}</p>
        )}

        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Contanos qué está pasando..."
          className="report-textarea"
        />

        <PhotoUpload
          photos={photos}
          onAdd={(f) => setPhotos((prev) => (prev.length < 4 ? [...prev, f] : prev))}
          onRemove={(i) => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
        />

        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Ubicación aproximada (calle, esquina...)"
          className="report-location"
        />

        <button
          type="submit"
          className="report-submit"
          disabled={!text.trim() || sending}
        >
          {sending
            ? "Enviando..."
            : `Enviar reporte${photos.length > 0 ? ` (${photos.length} foto${photos.length > 1 ? "s" : ""})` : ""}`}
        </button>

        {error && <p className="report-error">{error}</p>}
      </form>
    </div>
  );
}
