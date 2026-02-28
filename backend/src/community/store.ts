/**
 * Community Reports Store
 * 
 * Manages the lifecycle of resident reports:
 *   ingest → accumulate → classify → serve dashboard
 * 
 * Storage: filesystem-based (consistent with Talkative's fs persistence driver).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

// ── Types ──────────────────────────────────────────────────

export interface CommunityReport {
  id: string;
  resident_id: string;
  text: string;
  timestamp: string;
  location?: {
    lat?: number;
    lng?: number;
    address_hint?: string;
  };
  attachments?: Array<{ type: string; url: string }>;
  status: "pending" | "classified";
  classified_at?: string;
}

export interface ClassificationItem {
  report_id: string;
  category: string;
  subcategory: string;
  urgency: number;
  summary: string;
  location_normalized: string | null;
  confidence: number;
  reasoning: string;
  routed_to: string;
}

export interface ClassificationReport {
  ok: boolean;
  generatedAt: string;
  skillName: string;
  data: {
    totals: Record<string, number>;
    items: ClassificationItem[];
    routing_summary: Record<string, {
      label: string;
      count: number;
      highest_urgency: number;
      notify: boolean;
    }>;
  };
  metrics: {
    reportCount: number;
    llmCalls: number;
    totalTokensEstimate: number;
    batchSize: number;
    categoriesVersion: string;
  };
}

export interface DashboardData {
  totals: Record<string, number>;
  routing_summary: Record<string, {
    label: string;
    count: number;
    highest_urgency: number;
    notify: boolean;
  }>;
  recent_items: ClassificationItem[];
  pending_count: number;
  last_classification_at: string | null;
  reports_today: number;
  reports_this_week: number;
}

// ── Paths ──────────────────────────────────────────────────

function communityDir(workspaceDir: string): string {
  return path.join(workspaceDir, "community");
}

function reportsFilePath(workspaceDir: string): string {
  return path.join(communityDir(workspaceDir), "all-reports.json");
}

function pendingFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, "inputs", "pending-reports.json");
}

function classificationFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, "outputs", "classification-report.json");
}

// ── Helpers ────────────────────────────────────────────────

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ── Urgency Detection ──────────────────────────────────────

/** Keywords that suggest the report may be urgent (urgency 4-5). */
const URGENCY_KEYWORDS = [
  // Fire / smoke
  "fuego", "incendio", "quemado", "humo", "llama",
  // Active threat
  "robo", "robando", "asalto", "asaltando", "arma", "disparo", "tiro",
  // Medical
  "herido", "accidente", "ambulancia", "desmayo",
  // Flood
  "inundacion", "inundación",
];

/**
 * Returns true if the report text contains high-urgency keywords.
 * Used to decide whether to trigger immediate classification.
 */
export function isLikelyUrgent(text: string): boolean {
  const lower = text.toLowerCase();
  return URGENCY_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Optional callback to trigger auto-classification when urgent report arrives. */
let _onUrgentReport: ((workspaceDir: string) => void) | null = null;

export function setOnUrgentReport(cb: (workspaceDir: string) => void): void {
  _onUrgentReport = cb;
}

// ── Public API ─────────────────────────────────────────────

export async function ingestReport(
  workspaceDir: string,
  input: {
    resident_id: string;
    text: string;
    location?: { lat?: number; lng?: number; address_hint?: string };
    attachments?: Array<{ type: string; url: string }>;
  }
): Promise<CommunityReport> {
  await ensureDir(communityDir(workspaceDir));
  await ensureDir(path.join(workspaceDir, "inputs"));

  const report: CommunityReport = {
    id: `report-${nanoid(10)}`,
    resident_id: input.resident_id,
    text: input.text,
    timestamp: new Date().toISOString(),
    location: input.location,
    attachments: input.attachments,
    status: "pending",
  };

  const allReports = await readJsonFile<CommunityReport[]>(reportsFilePath(workspaceDir), []);
  allReports.push(report);
  await writeJsonFile(reportsFilePath(workspaceDir), allReports);

  const pending = await readJsonFile<CommunityReport[]>(pendingFilePath(workspaceDir), []);
  pending.push(report);
  await writeJsonFile(pendingFilePath(workspaceDir), pending);

  // If the report looks urgent, trigger auto-classification
  if (isLikelyUrgent(input.text) && _onUrgentReport) {
    try {
      _onUrgentReport(workspaceDir);
    } catch {
      // Best effort — don't fail the ingest if trigger fails
    }
  }

  return report;
}

export async function getReports(
  workspaceDir: string,
  filter?: { status?: "pending" | "classified"; limit?: number }
): Promise<CommunityReport[]> {
  const all = await readJsonFile<CommunityReport[]>(reportsFilePath(workspaceDir), []);
  let filtered = filter?.status ? all.filter(r => r.status === filter.status) : all;
  if (filter?.limit) {
    filtered = filtered.slice(-filter.limit);
  }
  return filtered;
}

export async function getLatestClassification(
  workspaceDir: string
): Promise<ClassificationReport | null> {
  return readJsonFile<ClassificationReport | null>(classificationFilePath(workspaceDir), null);
}

export async function markReportsClassified(
  workspaceDir: string,
  reportIds: string[]
): Promise<void> {
  const idSet = new Set(reportIds);
  const allReports = await readJsonFile<CommunityReport[]>(reportsFilePath(workspaceDir), []);
  const now = new Date().toISOString();

  for (const report of allReports) {
    if (idSet.has(report.id) && report.status === "pending") {
      report.status = "classified";
      report.classified_at = now;
    }
  }

  await writeJsonFile(reportsFilePath(workspaceDir), allReports);
  await writeJsonFile(pendingFilePath(workspaceDir), []);
}

export async function buildDashboard(workspaceDir: string): Promise<DashboardData> {
  const allReports = await readJsonFile<CommunityReport[]>(reportsFilePath(workspaceDir), []);
  const classification = await getLatestClassification(workspaceDir);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const pendingCount = allReports.filter(r => r.status === "pending").length;
  const reportsToday = allReports.filter(r => r.timestamp >= todayStart).length;
  const reportsThisWeek = allReports.filter(r => r.timestamp >= weekStart).length;

  if (!classification || !classification.data) {
    return {
      totals: {},
      routing_summary: {},
      recent_items: [],
      pending_count: pendingCount,
      last_classification_at: null,
      reports_today: reportsToday,
      reports_this_week: reportsThisWeek,
    };
  }

  const recentItems = [...classification.data.items].reverse().slice(0, 20);

  return {
    totals: classification.data.totals,
    routing_summary: classification.data.routing_summary,
    recent_items: recentItems,
    pending_count: pendingCount,
    last_classification_at: classification.generatedAt,
    reports_today: reportsToday,
    reports_this_week: reportsThisWeek,
  };
}
