import {
  ApprovalRequest,
  AgentEvent,
  AgentMessageResponse,
  AgentRecord,
  AgentSkill,
  InterpreterResult,
  RouterBudgetCaps,
  RouterRuleSet,
  RouterUsageRecord,
  Workflow,
  WorkflowEdge,
  WorkflowNode
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:4000";
const FALLBACK_TENANT_ID = "tenant-default";

function resolveTenantId(): string {
  const fromStorage =
    typeof window !== "undefined" ? window.localStorage.getItem("tenant_id") ?? window.localStorage.getItem("x-tenant-id") : null;
  return fromStorage?.trim() || FALLBACK_TENANT_ID;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("x-tenant-id")) {
    headers.set("x-tenant-id", resolveTenantId());
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

/** Community-specific fetch that adds operator token or community code */
async function communityFetch(path: string, init?: RequestInit, opts?: { auth?: "operator" | "resident" }): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("x-tenant-id")) {
    headers.set("x-tenant-id", resolveTenantId());
  }

  if (opts?.auth === "operator") {
    const token = typeof window !== "undefined" ? localStorage.getItem("operator-token") : null;
    if (token) headers.set("x-operator-token", token);
  }

  if (opts?.auth === "resident") {
    const code = typeof window !== "undefined" ? localStorage.getItem("community-code") : null;
    if (code) headers.set("x-community-code", code);
  }

  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

async function parseOrThrow<T>(response: Response, fallbackError: string): Promise<T> {
  if (!response.ok) {
    try {
      const body = (await response.json()) as { error?: string };
      throw new Error(body.error ?? fallbackError);
    } catch {
      throw new Error(fallbackError);
    }
  }
  return response.json() as Promise<T>;
}

export async function saveWorkflow(payload: {
  id?: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): Promise<Workflow> {
  const response = await apiFetch("/workflow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return parseOrThrow<Workflow>(response, "Failed to save workflow");
}

export async function getWorkflow(id: string): Promise<Workflow> {
  const response = await apiFetch(`/workflow/${id}`);
  return parseOrThrow<Workflow>(response, "Workflow not found");
}

export async function interpretText(text: string): Promise<InterpreterResult> {
  const response = await apiFetch("/conversation/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: { type: "text", text } })
  });

  return parseOrThrow<InterpreterResult>(response, "Conversation interpretation failed");
}

export async function listAgents(): Promise<{ agents: AgentRecord[] }> {
  const response = await apiFetch("/agents");
  return parseOrThrow<{ agents: AgentRecord[] }>(response, "Failed to list agents");
}

export async function createAgent(payload: {
  id?: string;
  name: string;
  workspace?: string;
  template?: "mail-triage" | "git-watcher" | "monthly-bookkeeping" | "community-classifier";
}): Promise<AgentRecord> {
  const response = await apiFetch("/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseOrThrow<AgentRecord>(response, "Failed to create agent");
}

export async function startAgent(id: string): Promise<AgentRecord> {
  const response = await apiFetch(`/agents/${id}/start`, { method: "POST" });
  return parseOrThrow<AgentRecord>(response, "Failed to start agent");
}

export async function stopAgent(id: string): Promise<AgentRecord> {
  const response = await apiFetch(`/agents/${id}/stop`, { method: "POST" });
  return parseOrThrow<AgentRecord>(response, "Failed to stop agent");
}

export async function getAgentEvents(id: string, limit = 50): Promise<{ events: AgentEvent[] }> {
  const response = await apiFetch(`/agents/${id}/events?tail=${limit}`);
  return parseOrThrow<{ events: AgentEvent[] }>(response, "Failed to fetch agent events");
}

export async function getAgentSkills(id: string): Promise<{ skills: AgentSkill[] }> {
  const response = await apiFetch(`/agents/${id}/skills`);
  return parseOrThrow<{ skills: AgentSkill[] }>(response, "Failed to fetch agent skills");
}

export async function attachSkill(id: string, skillName: string): Promise<{ skills: AgentSkill[] }> {
  const response = await apiFetch(`/agents/${id}/skills/attach`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skillName })
  });

  return parseOrThrow<{ skills: AgentSkill[] }>(response, "Failed to attach skill");
}

export async function sendAgentMessage(id: string, message: string): Promise<AgentMessageResponse> {
  const response = await apiFetch(`/agents/${id}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });

  return parseOrThrow<AgentMessageResponse>(response, "Failed to send message");
}

export async function getRouterRules(): Promise<RouterRuleSet> {
  const response = await apiFetch("/router/admin/rules");
  return parseOrThrow<RouterRuleSet>(response, "Failed to fetch router rules");
}

export async function putRouterRules(payload: RouterRuleSet): Promise<RouterRuleSet> {
  const response = await apiFetch("/router/admin/rules", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseOrThrow<RouterRuleSet>(response, "Failed to save router rules");
}

export async function getRouterUsage(params: {
  tenant_id?: string;
  agent_id?: string;
  limit?: number;
  from?: string;
  to?: string;
}): Promise<{ usage: RouterUsageRecord[] }> {
  const query = new URLSearchParams();
  if (params.tenant_id) query.set("tenant_id", params.tenant_id);
  if (params.agent_id) query.set("agent_id", params.agent_id);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);

  const response = await apiFetch(`/router/admin/usage?${query.toString()}`);
  return parseOrThrow<{ usage: RouterUsageRecord[] }>(response, "Failed to fetch router usage");
}

export async function getRouterBudgets(): Promise<RouterBudgetCaps> {
  const response = await apiFetch("/router/admin/budgets");
  return parseOrThrow<RouterBudgetCaps>(response, "Failed to fetch router budgets");
}

export async function putRouterBudgets(payload: RouterBudgetCaps): Promise<RouterBudgetCaps> {
  const response = await apiFetch("/router/admin/budgets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseOrThrow<RouterBudgetCaps>(response, "Failed to save router budgets");
}

// ── Community Classifier API ───────────────────────────────

export interface CommunityReportInput {
  resident_id?: string;
  text: string;
  location?: { lat?: number; lng?: number; address_hint?: string };
  community_code?: string;
}

export interface CommunityDashboard {
  totals: Record<string, number>;
  routing_summary: Record<string, {
    label: string;
    count: number;
    highest_urgency: number;
    notify: boolean;
  }>;
  recent_items: Array<{
    report_id: string;
    category: string;
    subcategory: string;
    urgency: number;
    summary: string;
    location_normalized: string | null;
    confidence: number;
    routed_to: string;
  }>;
  pending_count: number;
  last_classification_at: string | null;
  reports_today: number;
  reports_this_week: number;
}

export async function submitCommunityReport(input: CommunityReportInput): Promise<{ accepted: boolean; report_id: string; message: string }> {
  const response = await communityFetch("/community/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, { auth: "resident" });
  return parseOrThrow(response, "Failed to submit report");
}

export async function operatorLogin(password: string): Promise<{ ok: boolean; token: string }> {
  const response = await communityFetch("/community/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const result = await parseOrThrow<{ ok: boolean; token: string }>(response, "Login failed");
  if (result.token) {
    localStorage.setItem("operator-token", result.token);
  }
  return result;
}

export async function validateCommunityCode(code: string): Promise<{ ok: boolean }> {
  const response = await communityFetch("/community/auth/validate-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const result = await parseOrThrow<{ ok: boolean }>(response, "Code validation failed");
  if (result.ok) {
    localStorage.setItem("community-code", code);
  }
  return result;
}

export async function getCommunityDashboard(): Promise<CommunityDashboard> {
  const response = await communityFetch("/community/dashboard", undefined, { auth: "operator" });
  return parseOrThrow<CommunityDashboard>(response, "Failed to fetch dashboard");
}

export async function getCommunityReports(filter?: { status?: string; limit?: number }): Promise<{ reports: unknown[]; total: number }> {
  const query = new URLSearchParams();
  if (filter?.status) query.set("status", filter.status);
  if (filter?.limit) query.set("limit", String(filter.limit));
  const response = await communityFetch(`/community/reports?${query.toString()}`, undefined, { auth: "operator" });
  return parseOrThrow(response, "Failed to fetch reports");
}

export async function triggerClassification(): Promise<{ triggered: boolean; response: string }> {
  const response = await communityFetch("/community/classify", { method: "POST" }, { auth: "operator" });
  return parseOrThrow(response, "Failed to trigger classification");
}

export async function uploadReportPhotos(reportId: string, files: File[]): Promise<{ photos: Array<{ id: string; filename: string }> }> {
  const formData = new FormData();
  for (const file of files) formData.append("photos", file);
  const response = await communityFetch(`/community/reports/${reportId}/photos`, {
    method: "POST",
    body: formData,
  }, { auth: "resident" });
  return parseOrThrow(response, "Failed to upload photos");
}

export async function getWeeklySummaries(limit = 10): Promise<{ summaries: unknown[] }> {
  const response = await communityFetch(`/community/weekly-summary?limit=${limit}`, undefined, { auth: "operator" });
  return parseOrThrow(response, "Failed to fetch weekly summaries");
}

export async function generateWeeklySummary(): Promise<{ summary: unknown }> {
  const response = await communityFetch("/community/weekly-summary/generate", { method: "POST" }, { auth: "operator" });
  return parseOrThrow(response, "Failed to generate weekly summary");
}

export interface ReportStatus {
  report_id: string;
  status: "pending" | "classified";
  submitted_at: string;
  classified_at: string | null;
  classification: {
    category: string;
    urgency: number;
    routed_to: string;
    summary: string;
  } | null;
  message: string;
}

export async function getReportStatus(reportId: string): Promise<ReportStatus> {
  const response = await apiFetch(`/community/reports/${reportId}/status`);
  return parseOrThrow<ReportStatus>(response, "Failed to fetch report status");
}

export async function getRouterMetrics(): Promise<{
  total_requests: number;
  total_tokens: number;
  total_cost: number;
  error_rate: number;
}> {
  const response = await apiFetch("/router/metrics");
  return parseOrThrow(response, "Failed to fetch router metrics");
}

export async function getApprovals(params: {
  tenant_id?: string;
  agent_id?: string;
  status?: "pending" | "approved" | "rejected";
  limit?: number;
}): Promise<{ approvals: ApprovalRequest[] }> {
  const query = new URLSearchParams();
  if (params.tenant_id) query.set("tenant_id", params.tenant_id);
  if (params.agent_id) query.set("agent_id", params.agent_id);
  if (params.status) query.set("status", params.status);
  if (params.limit) query.set("limit", String(params.limit));

  const response = await apiFetch(`/approvals?${query.toString()}`);
  return parseOrThrow<{ approvals: ApprovalRequest[] }>(response, "Failed to fetch approvals");
}

export async function decideApproval(input: {
  id: string;
  operator_id: string;
  decision: "approved" | "rejected";
  note?: string;
}): Promise<ApprovalRequest> {
  const response = await apiFetch(`/approvals/${input.id}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operator_id: input.operator_id,
      decision: input.decision,
      note: input.note
    })
  });
  return parseOrThrow<ApprovalRequest>(response, "Failed to decide approval");
}

// ── Incidents API ──────────────────────────────────────────

export type IncidentStatus = "open" | "in_progress" | "resolved" | "closed" | "re_opened";

export interface Incident {
  id: string;
  title: string;
  category: string;
  status: IncidentStatus;
  severity: number;
  zone: string | null;
  assigned_to: string | null;
  resolution_note: string | null;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  updated_at: string;
  report_count?: number;
}

export interface IncidentEvent {
  id: string;
  incident_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface IncidentSuggestion {
  report_id: string;
  report_text: string;
  report_category: string;
  report_summary: string;
  suggestion: { incident_id: string; confidence: number; reasoning: string };
}

export async function getIncidents(filter?: {
  status?: IncidentStatus;
  category?: string;
}): Promise<{ incidents: Incident[]; total: number }> {
  const query = new URLSearchParams();
  if (filter?.status) query.set("status", filter.status);
  if (filter?.category) query.set("category", filter.category);
  const qs = query.toString();
  const response = await apiFetch(`/community/incidents${qs ? `?${qs}` : ""}`);
  return parseOrThrow(response, "Failed to fetch incidents");
}

export async function getIncidentDetail(id: string): Promise<{
  incident: Incident;
  events: IncidentEvent[];
  linked_reports: unknown[];
}> {
  const response = await apiFetch(`/community/incidents/${id}`);
  return parseOrThrow(response, "Failed to fetch incident");
}

export async function createIncident(input: {
  title: string;
  category: string;
  severity?: number;
  zone?: string;
}): Promise<{ incident: Incident }> {
  const response = await apiFetch("/community/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseOrThrow(response, "Failed to create incident");
}

export async function updateIncidentStatus(id: string, status: IncidentStatus, resolution_note?: string): Promise<{ incident: Incident }> {
  const response = await apiFetch(`/community/incidents/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, resolution_note }),
  });
  return parseOrThrow(response, "Failed to update incident status");
}

export async function getSuggestions(): Promise<{ suggestions: IncidentSuggestion[]; total: number }> {
  const response = await apiFetch("/community/reports/suggestions");
  return parseOrThrow(response, "Failed to fetch suggestions");
}

export async function confirmSuggestion(report_id: string): Promise<{ confirmed: boolean }> {
  const response = await apiFetch(`/community/reports/${report_id}/suggestion/confirm`, {
    method: "POST",
  });
  return parseOrThrow(response, "Failed to confirm suggestion");
}

export async function dismissSuggestion(report_id: string): Promise<{ dismissed: boolean }> {
  const response = await apiFetch(`/community/reports/${report_id}/suggestion/dismiss`, {
    method: "POST",
  });
  return parseOrThrow(response, "Failed to dismiss suggestion");
}
