/**
 * Community Classify Service — Direct LLM classification
 *
 * Product-grade approach: reads pending reports from SQLite,
 * calls LLM, writes results back to SQLite. No intermediate files,
 * no agent runner, no workspace JSONs.
 *
 * Called directly from routesV2.ts POST /community/classify
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getPendingReportsForClassification, markReportsClassified, saveClassificationRun } from "./storeSqlite.js";
import type { ClassificationItem } from "./storeSqlite.js";
import { getDb } from "./db.js";
import {
  getOpenIncidentsByCategory,
  linkReportToIncident,
  AUTO_CREATE_THRESHOLD,
  SUGGEST_THRESHOLD,
} from "./incidentStore.js";
import type { Incident, IncidentSuggestion } from "./incidentStore.js";

// ── Types ──────────────────────────────────────────────────

interface CategoryDef {
  id: string;
  label: string;
  description: string;
  subcategories: string[];
  route_to: string;
  urgency_boost: number;
  keywords_hint: string[];
}

interface CategoriesConfig {
  version: string;
  categories: CategoryDef[];
  default_category: string;
  confidence_threshold: number;
  routing: Record<string, { label: string; notify: boolean }>;
}

interface LLMClassificationItem {
  report_id: string;
  category: string;
  subcategory: string;
  urgency: number;
  summary: string;
  location_normalized: string | null;
  confidence: number;
  reasoning: string;
}

interface ClassifyResult {
  ok: boolean;
  classified: number;
  failed: number;
  items: ClassificationItem[];
  durationMs: number;
  error?: string;
  incidentMatches?: IncidentMatchItem[];
}

interface IncidentMatchItem {
  report_id: string;
  suggestion: IncidentSuggestion | null;   // null = no match found
  action: "auto_linked" | "suggested" | "none";
}

interface LLMIncidentMatch {
  report_id: string;
  matched_incident_id: string | null;
  confidence: number;
  reasoning: string;
}

// ── Load categories config ─────────────────────────────────

let _categoriesConfig: CategoriesConfig | null = null;

function loadCategories(): CategoriesConfig {
  if (_categoriesConfig) return _categoriesConfig;

  // Navigate from backend/src/community/ → backend/ → project root → skills/...
  const configPath = path.resolve(
    __dirname,
    "../../../skills/templates/community-classifier/references/categories.json"
  );

  if (!fs.existsSync(configPath)) {
    throw new Error(`Categories config not found at ${configPath}`);
  }

  _categoriesConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")) as CategoriesConfig;
  return _categoriesConfig;
}

// ── LLM caller ─────────────────────────────────────────────

async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.LLM_API_KEY || process.env.GEMINI_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";
  const model = process.env.LLM_MODEL ?? "gemini-2.5-flash";

  if (!apiKey) {
    throw new Error("LLM_API_KEY or GEMINI_API_KEY not set. Cannot classify reports.");
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM API error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty response");

  return content;
}

// ── Prompts ────────────────────────────────────────────────

function buildIncidentMatchSystemPrompt(): string {
  return `You are an incident deduplication assistant for a residential neighborhood security system.

Your job is to determine if a newly classified report describes the same real-world problem as one of the currently open incidents.

Rules:
- Only match if the report and incident clearly refer to the same physical event or ongoing problem.
- Do NOT match just because the category is similar — the problem must be the same.
- Consider location, description, and timing.
- Output confidence 0.0 to 1.0. Use >= 0.80 only when very certain.
- If no incident matches, output matched_incident_id as null with confidence 0.`;
}

function buildIncidentMatchUserPrompt(
  reports: Array<{ id: string; text: string; category: string; location?: string }>,
  openIncidents: Incident[]
): string {
  const incidentSummaries = openIncidents.map((inc) => ({
    id: inc.id,
    title: inc.title,
    category: inc.category,
    status: inc.status,
    zone: inc.zone,
    report_count: inc.report_count,
    created_at: inc.created_at,
  }));

  return `Open incidents to compare against:
${JSON.stringify(incidentSummaries, null, 2)}

For each report below, decide if it matches one of the open incidents.
Respond ONLY with valid JSON matching this schema:

{
  "matches": [
    {
      "report_id": "the report id",
      "matched_incident_id": "incident id or null",
      "confidence": 0.85,
      "reasoning": "brief explanation"
    }
  ]
}

Reports to evaluate:
${JSON.stringify(reports, null, 2)}`;
}

function buildSystemPrompt(): string {
  return `You are a community report classifier for a residential neighborhood security and management system.

Your job is to analyze reports submitted by residents and classify each one into the correct category.
Reports are informal, written in Argentine Spanish, and may contain typos, slang, or vague descriptions.

You must determine:
1. **category**: The primary category ID from the provided list
2. **subcategory**: A more specific label within that category
3. **urgency**: A score from 1 to 5:
   - 1: Informational, no action needed now
   - 2: Low priority, can be addressed in normal workflow
   - 3: Medium priority, should be addressed within 24-48h
   - 4: High priority, needs attention today
   - 5: Emergency, requires immediate response
4. **summary**: A clean, one-line summary of the report in neutral language
5. **location_normalized**: If location info is present, normalize it. If not, output null.
6. **confidence**: 0.0 to 1.0 how confident you are in the classification
7. **reasoning**: Brief explanation of why you chose this category

Be conservative with urgency — only use 4-5 for genuine safety risks or emergencies.
When in doubt between categories, prefer the one with higher safety impact.
If a report contains multiple issues, classify by the most urgent one.`;
}

function buildUserPrompt(
  categories: CategoryDef[],
  reports: Array<{ id: string; text: string; timestamp: string; location?: { address_hint?: string } }>
): string {
  const catSummary = categories.map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description,
    subcategories: c.subcategories,
  }));

  const reportsSummary = reports.map((r) => ({
    id: r.id,
    text: r.text,
    timestamp: r.timestamp,
    location: r.location ?? null,
  }));

  return `Here are the available categories:

${JSON.stringify(catSummary, null, 2)}

Classify the following batch of reports. Respond ONLY with valid JSON matching this schema:

{
  "classifications": [
    {
      "report_id": "the original report id",
      "category": "category id from the list",
      "subcategory": "specific subcategory",
      "urgency": 3,
      "summary": "clean one-line summary",
      "location_normalized": "normalized location or null",
      "confidence": 0.85,
      "reasoning": "brief explanation of classification decision"
    }
  ]
}

Reports to classify:

${JSON.stringify(reportsSummary, null, 2)}`;
}

// ── Validation ─────────────────────────────────────────────

function validateItem(
  item: LLMClassificationItem,
  validIds: Set<string>,
  config: CategoriesConfig
): ClassificationItem {
  // Ensure category is valid
  if (!validIds.has(item.category)) {
    item.category = config.default_category;
    item.confidence = Math.min(item.confidence, 0.4);
    item.reasoning += " [category corrected to default]";
  }

  // Clamp urgency
  item.urgency = Math.max(1, Math.min(5, Math.round(item.urgency)));

  // Apply urgency boost
  const catDef = config.categories.find((c) => c.id === item.category);
  if (catDef && catDef.urgency_boost > 0) {
    item.urgency = Math.min(5, item.urgency + catDef.urgency_boost);
  }

  // Clamp confidence
  item.confidence = Math.max(0, Math.min(1, item.confidence));

  // Resolve route
  const routed_to = catDef?.route_to ?? "municipalidad";

  return {
    report_id: item.report_id,
    category: item.category,
    subcategory: item.subcategory,
    urgency: item.urgency,
    summary: item.summary,
    location_normalized: item.location_normalized,
    confidence: item.confidence,
    reasoning: item.reasoning,
    routed_to,
  };
}

// ── Main classify function ─────────────────────────────────

export async function classifyPendingReports(
  tenant_id: string,
  options?: { batchSize?: number }
): Promise<ClassifyResult> {
  const startMs = Date.now();
  const batchSize = options?.batchSize ?? 10;

  // 1. Read pending from SQLite
  const pending = getPendingReportsForClassification(tenant_id);

  if (pending.length === 0) {
    return {
      ok: true,
      classified: 0,
      failed: 0,
      items: [],
      durationMs: Date.now() - startMs,
    };
  }

  // 2. Load config
  const config = loadCategories();
  const validIds = new Set(config.categories.map((c) => c.id));

  // 3. Process in batches
  const allItems: ClassificationItem[] = [];
  let llmCalls = 0;
  let tokensEstimate = 0;
  let failedCount = 0;
  const systemPrompt = buildSystemPrompt();

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const userPrompt = buildUserPrompt(config.categories, batch);

    try {
      const raw = await callLLM(systemPrompt, userPrompt);
      llmCalls++;

      // Parse — handle markdown fences
      let cleaned = raw.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }

      const parsed = JSON.parse(cleaned) as { classifications: LLMClassificationItem[] };

      if (!Array.isArray(parsed.classifications)) {
        console.error("[classifyService] LLM returned no classifications array");
        failedCount += batch.length;
        continue;
      }

      for (const cls of parsed.classifications) {
        allItems.push(validateItem(cls, validIds, config));
      }

      tokensEstimate += Math.round((systemPrompt.length + userPrompt.length + raw.length) / 4);
    } catch (err) {
      console.error("[classifyService] Batch failed:", (err as Error).message);
      failedCount += batch.length;

      // Fallback: mark as default with zero confidence
      for (const report of batch) {
        const catDef = config.categories.find((c) => c.id === config.default_category);
        allItems.push({
          report_id: report.id,
          category: config.default_category,
          subcategory: "otro",
          urgency: 2,
          summary: `[Classification failed] ${report.text.slice(0, 80)}`,
          location_normalized: report.location?.address_hint ?? null,
          confidence: 0,
          reasoning: `LLM call failed: ${(err as Error).message}`,
          routed_to: catDef?.route_to ?? "municipalidad",
        });
      }
    }
  }

  // 4. Write classification results back to SQLite
  if (allItems.length > 0) {
    markReportsClassified(tenant_id, allItems);
  }

  // 5. Incident matching — group classified items by category, then run one LLM call per category
  const incidentMatches: IncidentMatchItem[] = [];

  if (allItems.length > 0) {
    // Group by category to minimise LLM calls
    const byCategory = new Map<string, ClassificationItem[]>();
    for (const item of allItems) {
      const bucket = byCategory.get(item.category) ?? [];
      bucket.push(item);
      byCategory.set(item.category, bucket);
    }

    for (const [category, items] of byCategory) {
      // Pre-filter: only fetch open incidents of this category
      const openIncidents = getOpenIncidentsByCategory(tenant_id, category);

      if (openIncidents.length === 0) {
        // No open incidents for this category — mark all as none
        for (const item of items) {
          incidentMatches.push({ report_id: item.report_id, suggestion: null, action: "none" });
        }
        continue;
      }

      // Build LLM prompt with report summaries + open incidents
      const reportSummaries = items.map((it) => ({
        id: it.report_id,
        text: pending.find((p) => p.id === it.report_id)?.text ?? "",
        category: it.category,
        location: it.location_normalized ?? undefined,
      }));

      const matchUserPrompt = buildIncidentMatchUserPrompt(reportSummaries, openIncidents);
      const matchSystemPrompt = buildIncidentMatchSystemPrompt();

      try {
        const raw = await callLLM(matchSystemPrompt, matchUserPrompt);
        llmCalls++;

        let cleaned = raw.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
        }

        const parsed = JSON.parse(cleaned) as { matches: LLMIncidentMatch[] };

        for (const match of parsed.matches) {
          if (!match.matched_incident_id || match.confidence < SUGGEST_THRESHOLD) {
            incidentMatches.push({ report_id: match.report_id, suggestion: null, action: "none" });
            continue;
          }

          const suggestion: IncidentSuggestion = {
            incident_id: match.matched_incident_id,
            confidence: match.confidence,
            reasoning: match.reasoning,
          };

          if (match.confidence >= AUTO_CREATE_THRESHOLD) {
            // High confidence — auto-link
            linkReportToIncident(tenant_id, match.report_id, match.matched_incident_id, "system");
            incidentMatches.push({ report_id: match.report_id, suggestion, action: "auto_linked" });
          } else {
            // Medium confidence — store suggestion for operator review
            storeSuggestion(tenant_id, match.report_id, suggestion);
            incidentMatches.push({ report_id: match.report_id, suggestion, action: "suggested" });
          }
        }
      } catch (err) {
        console.error("[classifyService] Incident match batch failed:", (err as Error).message);
        for (const item of items) {
          incidentMatches.push({ report_id: item.report_id, suggestion: null, action: "none" });
        }
      }
    }
  }

  // 6. Save classification run metrics
  const durationMs = Date.now() - startMs;
  saveClassificationRun(tenant_id, {
    reportCount: pending.length,
    llmCalls,
    totalTokensEstimate: tokensEstimate,
    durationMs,
  });

  return {
    ok: failedCount === 0,
    classified: allItems.length - failedCount,
    failed: failedCount,
    items: allItems,
    durationMs,
    incidentMatches,
  };
}

// ── Suggestion persistence ─────────────────────────────────────────────────────
// Suggestions pending operator review are stored in a lightweight JSON column
// on the report row itself to avoid adding another table at this stage.

function storeSuggestion(
  tenant_id: string,
  report_id: string,
  suggestion: IncidentSuggestion
): void {
  try {
    getDb().prepare(
      "UPDATE reports SET incident_suggestion = ? WHERE id = ? AND tenant_id = ?"
    ).run(JSON.stringify(suggestion), report_id, tenant_id);
  } catch (err) {
    console.error("[classifyService] storeSuggestion failed:", (err as Error).message);
  }
}
