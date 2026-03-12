/**
 * Community Routes v2
 *
 * Now backed by SQLite store, with auth middleware and photo upload.
 *
 * Public (no auth):
 *   POST /community/auth/validate-code
 *   POST /community/auth/login
 *
 * Resident (community code required):
 *   POST /community/reports
 *   GET  /community/reports/:id/status
 *   POST /community/reports/:id/photos
 *   GET  /community/photos/:photoId
 *
 * Operator (password):
 *   POST /community/auth/login
 *   GET  /community/reports
 *   GET  /community/dashboard
 *   POST /community/classify
 *   GET  /community/weekly-summary
 *   POST /community/weekly-summary/generate
 */

import { Router } from "express";
import multer from "multer";
import { agentHub } from "../agents/agentHub.js";
import { getTenantIdOrThrow } from "../tenancy/guard.js";
import {
  ingestReport,
  getReports,
  getReportById,
  buildDashboard,
  setOnUrgentReport,
  generateWeeklySummary,
  getWeeklySummaries,
} from "./storeSqlite.js";
import {
  createIncident,
  getIncidents,
  getIncidentById,
  getIncidentEvents,
  updateIncidentStatus,
  assignIncident,
  linkReportToIncident,
  unlinkReportFromIncident,
} from "./incidentStore.js";
import type { IncidentStatus } from "./incidentStore.js";
import { savePhoto, getPhotosForReport, getPhotoBuffer } from "./photoStorage.js";
import { requireCommunityCode, requireOperator, handleLogin, handleValidateCode } from "./auth.js";
import { classifyPendingReports } from "./classifyService.js";

export const communityRouter = Router();

// Multer for photo uploads (max 5MB, max 4 files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith("image/"));
  },
});

// ── Wire urgent auto-classification ────────────────────────

setOnUrgentReport((tenant_id) => {
  const agent = agentHub.findByTemplate("community-classifier", tenant_id);
  if (agent && agent.status === "running") {
    agentHub.sendMessage(agent.id, "clasificar reportes pendientes", tenant_id).catch(() => {});
  }
});

// ── Auth endpoints (no middleware) ─────────────────────────

communityRouter.post("/community/auth/login", handleLogin);
communityRouter.post("/community/auth/validate-code", handleValidateCode);

// ── Resident endpoints (community code) ───────────────────

communityRouter.post("/community/reports", requireCommunityCode, async (req, res) => {
  try {
    const { resident_id, text, location, category_hint } = req.body as {
      resident_id?: string;
      text?: string;
      location?: { lat?: number; lng?: number; address_hint?: string };
      category_hint?: string;
      community_code?: string;  // consumed by middleware
    };

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const tenant_id = req.community_tenant_id;
    if (!tenant_id) {
      return res.status(400).json({ error: "Tenant context missing for community request" });
    }

    const report = ingestReport(tenant_id, {
      resident_id: resident_id || `anon-${Date.now()}`,
      text: text.trim(),
      category_hint,
      location,
    });

    res.status(201).json({
      accepted: true,
      report_id: report.id,
      message: "Reporte recibido. Gracias por ayudar a mantener seguro el barrio.",
    });

    // Auto-classify in background (fire-and-forget, does not block response)
    if (process.env.AUTO_CLASSIFY !== "false") {
      setImmediate(async () => {
        try {
          await classifyPendingReports(tenant_id);
        } catch (err) {
          console.error("[auto-classify] background classification failed:", (err as Error).message);
        }
      });
    }

    return;
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// Security: resident status lookup must always require community code.
communityRouter.get("/community/reports/:id/status", requireCommunityCode, async (req, res) => {
  try {
    const tenant_id = req.community_tenant_id;
    if (!tenant_id) {
      return res.status(400).json({ error: "Tenant context missing for community request" });
    }
    const report = getReportById(tenant_id, req.params.id);

    if (!report) {
      return res.status(404).json({ error: "Reporte no encontrado" });
    }

    const photos = getPhotosForReport(report.id);

    return res.json({
      report_id: report.id,
      status: report.status,
      submitted_at: report.timestamp,
      classified_at: report.classified_at ?? null,
      classification: report.status === "classified" ? {
        category: report.category,
        urgency: report.urgency,
        routed_to: report.routed_to,
        summary: report.summary,
      } : null,
      photo_count: photos.length,
      message:
        report.status === "pending"
          ? "Tu reporte está siendo procesado."
          : report.routed_to
            ? `Tu reporte fue derivado a: ${report.routed_to.replace(/_/g, " ")}.`
            : "Tu reporte fue clasificado.",
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── Photo upload & serving ─────────────────────────────────

communityRouter.post("/community/reports/:id/photos", requireCommunityCode, upload.array("photos", 4), async (req, res) => {
  try {
    const tenant_id = req.community_tenant_id;
    if (!tenant_id) {
      return res.status(400).json({ error: "Tenant context missing for community request" });
    }
    const report = getReportById(tenant_id, req.params.id);

    if (!report) {
      return res.status(404).json({ error: "Reporte no encontrado" });
    }

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No photos provided" });
    }

    const saved = [];
    for (const file of files) {
      const photo = await savePhoto(report.id, {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });
      saved.push({ id: photo.id, filename: photo.filename });
    }

    return res.status(201).json({ photos: saved });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// Security: photo content is protected and tenant-scoped via community code.
communityRouter.get("/community/photos/:photoId", requireCommunityCode, async (req, res) => {
  try {
    const tenant_id = req.community_tenant_id;
    if (!tenant_id) {
      return res.status(400).json({ error: "Tenant context missing for community request" });
    }
    const result = await getPhotoBuffer(req.params.photoId, tenant_id);
    if (!result) {
      return res.status(404).json({ error: "Photo not found" });
    }

    res.setHeader("Content-Type", result.mimetype);
    res.setHeader("Content-Disposition", `inline; filename="${result.filename}"`);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(result.buffer);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── Operator endpoints (password) ──────────────────────────

communityRouter.get("/community/reports", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const status = req.query.status as "pending" | "classified" | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const reports = getReports(tenant_id, { status, limit });
    return res.json({ reports, total: reports.length });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.get("/community/dashboard", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const dashboard = buildDashboard(tenant_id);
    return res.json(dashboard);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.post("/community/classify", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const result = await classifyPendingReports(tenant_id);

    return res.json({
      ok: result.ok,
      classified: result.classified,
      failed: result.failed,
      duration_ms: result.durationMs,
      items: result.items,
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── Weekly summary ─────────────────────────────────────────

communityRouter.get("/community/weekly-summary", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const summaries = getWeeklySummaries(tenant_id, limit);
    return res.json({ summaries });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.post("/community/weekly-summary/generate", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const summary = generateWeeklySummary(tenant_id);
    return res.json({ summary });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── Incident endpoints (operator only) ────────────────────
//
// GET    /community/incidents              — list, filterable by status/category
// POST   /community/incidents              — create incident manually
// GET    /community/incidents/:id          — detail + event history
// PATCH  /community/incidents/:id/status   — transition status
// PATCH  /community/incidents/:id/assign   — assign to operator
// POST   /community/incidents/:id/reports  — link a report
// DELETE /community/incidents/:id/reports/:report_id — unlink a report
// GET    /community/reports/suggestions    — reports with pending LLM suggestions
// POST   /community/reports/:id/suggestion/confirm  — operator confirms suggestion
// POST   /community/reports/:id/suggestion/dismiss  — operator dismisses suggestion

communityRouter.get("/community/incidents", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const status = req.query.status as IncidentStatus | undefined;
    const category = req.query.category as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const incidents = getIncidents(tenant_id, { status, category, limit });
    return res.json({ incidents, total: incidents.length });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.post("/community/incidents", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const { title, category, severity, zone, lat, lng } = req.body as {
      title?: string;
      category?: string;
      severity?: number;
      zone?: string;
      lat?: number;
      lng?: number;
    };

    if (!title?.trim()) return res.status(400).json({ error: "title is required" });
    if (!category?.trim()) return res.status(400).json({ error: "category is required" });

    const incident = createIncident(tenant_id, {
      title: title.trim(),
      category,
      severity,
      zone,
      lat,
      lng,
      created_by: "operator",
    });

    return res.status(201).json({ incident });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.get("/community/incidents/:id", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const incident = getIncidentById(tenant_id, req.params.id);

    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const events = getIncidentEvents(incident.id);
    const db = (await import("./db.js")).getDb();
    const linkedReports = db.prepare(
      "SELECT * FROM reports WHERE incident_id = ? AND tenant_id = ? ORDER BY created_at DESC"
    ).all(incident.id, tenant_id);

    return res.json({ incident, events, linked_reports: linkedReports });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.patch("/community/incidents/:id/status", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const { status, resolution_note } = req.body as {
      status?: IncidentStatus;
      resolution_note?: string;
    };

    const validStatuses: IncidentStatus[] = ["open", "in_progress", "resolved", "closed", "re_opened"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }

    const updated = updateIncidentStatus(tenant_id, req.params.id, status, {
      resolution_note,
      updated_by: "operator",
    });

    if (!updated) return res.status(404).json({ error: "Incident not found" });
    return res.json({ incident: updated });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.patch("/community/incidents/:id/assign", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const { assigned_to } = req.body as { assigned_to?: string };

    if (!assigned_to?.trim()) return res.status(400).json({ error: "assigned_to is required" });

    const updated = assignIncident(tenant_id, req.params.id, assigned_to.trim(), "operator");
    if (!updated) return res.status(404).json({ error: "Incident not found" });
    return res.json({ incident: updated });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.post("/community/incidents/:id/reports", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const { report_id } = req.body as { report_id?: string };

    if (!report_id?.trim()) return res.status(400).json({ error: "report_id is required" });

    const ok = linkReportToIncident(tenant_id, report_id.trim(), req.params.id, "operator");
    if (!ok) return res.status(404).json({ error: "Incident not found or report does not belong to this tenant" });

    return res.json({ linked: true, report_id, incident_id: req.params.id });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.delete("/community/incidents/:id/reports/:report_id", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const ok = unlinkReportFromIncident(tenant_id, req.params.report_id, "operator");
    if (!ok) return res.status(404).json({ error: "Report not linked to any incident" });

    return res.json({ unlinked: true, report_id: req.params.report_id });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── Suggestion review endpoints ────────────────────────────

communityRouter.get("/community/reports/suggestions", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const db = (await import("./db.js")).getDb();

    const rows = db.prepare(`
      SELECT r.*, r.incident_suggestion
      FROM reports r
      WHERE r.tenant_id = ?
        AND r.incident_suggestion IS NOT NULL
        AND r.incident_id IS NULL
      ORDER BY r.created_at DESC
    `).all(tenant_id) as Array<Record<string, unknown>>;

    const suggestions = rows.map((r) => ({
      report_id: r.id,
      report_text: r.text,
      report_category: r.category,
      report_summary: r.summary,
      suggestion: JSON.parse(r.incident_suggestion as string),
    }));

    return res.json({ suggestions, total: suggestions.length });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.post("/community/reports/:id/suggestion/confirm", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const db = (await import("./db.js")).getDb();

    const row = db.prepare(
      "SELECT incident_suggestion FROM reports WHERE id = ? AND tenant_id = ?"
    ).get(req.params.id, tenant_id) as { incident_suggestion: string | null } | undefined;

    if (!row?.incident_suggestion) {
      return res.status(404).json({ error: "No pending suggestion for this report" });
    }

    const suggestion = JSON.parse(row.incident_suggestion) as { incident_id: string };

    const ok = linkReportToIncident(tenant_id, req.params.id, suggestion.incident_id, "operator");
    if (!ok) return res.status(404).json({ error: "Incident not found" });

    // Clear suggestion after confirm
    db.prepare(
      "UPDATE reports SET incident_suggestion = NULL WHERE id = ? AND tenant_id = ?"
    ).run(req.params.id, tenant_id);

    return res.json({ confirmed: true, incident_id: suggestion.incident_id });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.post("/community/reports/:id/suggestion/dismiss", requireOperator, async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const db = (await import("./db.js")).getDb();

    const row = db.prepare(
      "SELECT incident_suggestion FROM reports WHERE id = ? AND tenant_id = ?"
    ).get(req.params.id, tenant_id) as { incident_suggestion: string | null } | undefined;

    if (!row?.incident_suggestion) {
      return res.status(404).json({ error: "No pending suggestion for this report" });
    }

    db.prepare(
      "UPDATE reports SET incident_suggestion = NULL WHERE id = ? AND tenant_id = ?"
    ).run(req.params.id, tenant_id);

    return res.json({ dismissed: true });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});
