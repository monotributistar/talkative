/**
 * Community Routes
 * 
 * Public-facing API for the community reporting system.
 * 
 * Endpoints:
 *   POST /community/reports          — Vecino submits a report
 *   GET  /community/reports          — List reports (admin)
 *   GET  /community/dashboard        — Dashboard data for security company
 *   GET  /community/classification   — Latest classification result
 *   POST /community/classify         — Trigger classification manually
 */

import { Router } from "express";
import { agentHub } from "../agents/agentHub.js";
import { getTenantIdOrThrow } from "../tenancy/guard.js";
import {
  ingestReport,
  getReports,
  buildDashboard,
  getLatestClassification,
  setOnUrgentReport,
} from "./store.js";

export const communityRouter = Router();

// Wire up auto-classification for urgent reports
setOnUrgentReport((workspaceDir) => {
  // Find which agent owns this workspace and trigger classify
  // We scan all tenants (in practice there's usually one)
  const allAgents = agentHub.listAgents({});
  const agent = allAgents.find((a) => a.workspace === workspaceDir && a.template === "community-classifier");
  if (agent && agent.status === "running") {
    // Fire and forget — non-blocking
    agentHub.sendMessage(agent.id, "clasificar reportes pendientes", agent.tenant_id).catch(() => {});
  }
});

/**
 * Find the community-classifier agent by template field.
 * No more fragile name-matching.
 */
function findCommunityAgent(tenant_id: string) {
  return agentHub.findByTemplate("community-classifier", tenant_id) ?? null;
}

// ── POST /community/reports — Vecino submits a report ──────

communityRouter.post("/community/reports", async (req, res) => {
  try {
    const { resident_id, text, location, attachments } = req.body as {
      resident_id?: string;
      text?: string;
      location?: { lat?: number; lng?: number; address_hint?: string };
      attachments?: Array<{ type: string; url: string }>;
    };

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    // For the resident-facing endpoint, tenant comes from config or default
    const tenant_id = (req.headers["x-tenant-id"] as string) || "tenant-default";
    const agent = findCommunityAgent(tenant_id);

    if (!agent) {
      return res.status(404).json({ error: "No community agent configured. Create one first." });
    }

    const report = await ingestReport(agent.workspace, {
      resident_id: resident_id || `anon-${Date.now()}`,
      text: text.trim(),
      location,
      attachments,
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

// ── GET /community/reports — List reports (admin) ──────────

communityRouter.get("/community/reports", async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const agent = findCommunityAgent(tenant_id);

    if (!agent) {
      return res.json({ reports: [] });
    }

    const status = req.query.status as "pending" | "classified" | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const reports = await getReports(agent.workspace, { status, limit });

    return res.json({ reports, total: reports.length });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── GET /community/dashboard — Dashboard for security co ───

communityRouter.get("/community/dashboard", async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const agent = findCommunityAgent(tenant_id);

    if (!agent) {
      return res.json({
        totals: {},
        routing_summary: {},
        recent_items: [],
        pending_count: 0,
        last_classification_at: null,
        reports_today: 0,
        reports_this_week: 0,
      });
    }

    const dashboard = await buildDashboard(agent.workspace);
    return res.json(dashboard);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── GET /community/classification — Latest classification ──

communityRouter.get("/community/classification", async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const agent = findCommunityAgent(tenant_id);

    if (!agent) {
      return res.json({ classification: null });
    }

    const classification = await getLatestClassification(agent.workspace);
    return res.json({ classification });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── GET /community/reports/:id/status — Vecino checks status ─

communityRouter.get("/community/reports/:id/status", async (req, res) => {
  try {
    const tenant_id = (req.headers["x-tenant-id"] as string) || "tenant-default";
    const agent = findCommunityAgent(tenant_id);

    if (!agent) {
      return res.status(404).json({ error: "No community agent configured" });
    }

    const reports = await getReports(agent.workspace, {});
    const report = reports.find((r) => r.id === req.params.id);

    if (!report) {
      return res.status(404).json({ error: "Reporte no encontrado" });
    }

    let classification_detail = null;
    if (report.status === "classified") {
      const classificationData = await getLatestClassification(agent.workspace);
      if (classificationData?.data?.items) {
        const match = classificationData.data.items.find(
          (item) => item.report_id === report.id
        );
        if (match) {
          classification_detail = {
            category: match.category,
            urgency: match.urgency,
            routed_to: match.routed_to,
            summary: match.summary,
          };
        }
      }
    }

    return res.json({
      report_id: report.id,
      status: report.status,
      submitted_at: report.timestamp,
      classified_at: report.classified_at ?? null,
      classification: classification_detail,
      message:
        report.status === "pending"
          ? "Tu reporte está siendo procesado."
          : classification_detail
            ? `Tu reporte fue derivado a: ${classification_detail.routed_to.replace(/_/g, " ")}.`
            : "Tu reporte fue clasificado.",
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ── POST /community/classify — Trigger classification ──────

communityRouter.post("/community/classify", async (req, res) => {
  try {
    const tenant_id = getTenantIdOrThrow(req);
    const communityAgent = findCommunityAgent(tenant_id);

    if (!communityAgent) {
      return res.status(404).json({ error: "No community agent found" });
    }

    if (communityAgent.status !== "running") {
      return res.status(400).json({ error: "Community agent is not running. Start it first." });
    }

    // Send classify command to the agent
    const response = await agentHub.sendMessage(
      communityAgent.id,
      "clasificar reportes pendientes",
      tenant_id
    );

    return res.json({
      triggered: true,
      agent_id: communityAgent.id,
      response: response.reply,
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});
