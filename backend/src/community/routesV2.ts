/**
 * Community Routes v2
 *
 * Now backed by SQLite store, with auth middleware and photo upload.
 *
 * Public (community code):
 *   POST /community/auth/validate-code
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
import { savePhoto, getPhotosForReport, getPhotoBuffer } from "./photoStorage.js";
import { requireCommunityCode, requireOperator, handleLogin, handleValidateCode } from "./auth.js";

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

    const tenant_id = (req.headers["x-tenant-id"] as string) || "tenant-default";

    const report = ingestReport(tenant_id, {
      resident_id: resident_id || `anon-${Date.now()}`,
      text: text.trim(),
      category_hint,
      location,
    });

    return res.status(201).json({
      accepted: true,
      report_id: report.id,
      message: "Reporte recibido. Gracias por ayudar a mantener seguro el barrio.",
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

communityRouter.get("/community/reports/:id/status", async (req, res) => {
  try {
    const tenant_id = (req.headers["x-tenant-id"] as string) || "tenant-default";
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
    const tenant_id = (req.headers["x-tenant-id"] as string) || "tenant-default";
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

communityRouter.get("/community/photos/:photoId", async (req, res) => {
  try {
    const result = await getPhotoBuffer(req.params.photoId);
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
    const agent = agentHub.findByTemplate("community-classifier", tenant_id);

    if (!agent) {
      return res.status(404).json({ error: "No community agent found" });
    }

    if (agent.status !== "running") {
      return res.status(400).json({ error: "Community agent is not running" });
    }

    const response = await agentHub.sendMessage(agent.id, "clasificar reportes pendientes", tenant_id);
    return res.json({ triggered: true, agent_id: agent.id, response: response.reply });
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
