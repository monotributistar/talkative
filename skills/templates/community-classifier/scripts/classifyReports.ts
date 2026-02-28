#!/usr/bin/env node
/**
 * Community Classifier — LLM-driven report classification
 * 
 * Usage:
 *   node classifyReports.ts --input ./reports.json --output ./classification.json
 *   node classifyReports.ts --input ./reports.json --output ./classification.json --categories ./custom-categories.json --batch-size 3
 * 
 * Requires environment variables:
 *   LLM_API_KEY     — API key for the LLM provider
 *   LLM_BASE_URL    — Base URL (OpenAI-compatible endpoint)
 *   LLM_MODEL       — Model name (default: gemini-2.5-flash)
 */

import fs from "node:fs";
import path from "node:path";
import { writeSkillReport } from "../../../lib/skillReport.js";

// ── Types ──────────────────────────────────────────────────

interface CommunityReport {
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
}

interface CategoryDef {
  id: string;
  label: string;
  description: string;
  subcategories: string[];
  route_to: string;
  urgency_boost: number;
  keywords_hint: string[];
}

interface RoutingDef {
  label: string;
  notify: boolean;
}

interface CategoriesConfig {
  version: string;
  categories: CategoryDef[];
  default_category: string;
  confidence_threshold: number;
  routing: Record<string, RoutingDef>;
}

interface ClassificationResult {
  report_id: string;
  category: string;
  subcategory: string;
  urgency: number;
  summary: string;
  location_normalized: string | null;
  confidence: number;
  reasoning: string;
}

interface LLMClassificationResponse {
  classifications: ClassificationResult[];
}

// ── CLI args ───────────────────────────────────────────────

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

// ── LLM caller (reuses pattern from master-orchestrator) ──

async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";
  const model = process.env.LLM_MODEL ?? "gemini-2.5-flash";

  if (!apiKey) {
    throw new Error("LLM_API_KEY not set. Required for community-classifier skill.");
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

// ── Prompt builder ─────────────────────────────────────────

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

Be conservative with urgency — only use 4-5 for genuine safety risks or emergencies.
When in doubt between categories, prefer the one with higher safety impact.
If a report contains multiple issues, classify by the most urgent one.`;
}

function buildUserPrompt(categories: CategoryDef[], reports: CommunityReport[]): string {
  // Only send the fields the LLM needs for classification (no keywords_hint, no route_to)
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
    has_attachments: (r.attachments?.length ?? 0) > 0,
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

// ── Validation & post-processing ───────────────────────────

function validateClassification(
  result: ClassificationResult,
  validCategoryIds: Set<string>,
  config: CategoriesConfig
): ClassificationResult {
  // Ensure category is valid, fallback to default
  if (!validCategoryIds.has(result.category)) {
    result.category = config.default_category;
    result.confidence = Math.min(result.confidence, 0.4);
    result.reasoning += " [category corrected to default — LLM returned unknown category]";
  }

  // Clamp urgency
  result.urgency = Math.max(1, Math.min(5, Math.round(result.urgency)));

  // Apply urgency boost from category config
  const catDef = config.categories.find((c) => c.id === result.category);
  if (catDef && catDef.urgency_boost > 0) {
    result.urgency = Math.min(5, result.urgency + catDef.urgency_boost);
  }

  // Clamp confidence
  result.confidence = Math.max(0, Math.min(1, result.confidence));

  return result;
}

function buildRoutingSummary(
  items: Array<ClassificationResult & { routed_to: string }>,
  config: CategoriesConfig
): Record<string, { label: string; count: number; highest_urgency: number; notify: boolean }> {
  const summary: Record<string, { label: string; count: number; highest_urgency: number; notify: boolean }> = {};

  for (const item of items) {
    if (!summary[item.routed_to]) {
      const routeDef = config.routing[item.routed_to];
      summary[item.routed_to] = {
        label: routeDef?.label ?? item.routed_to,
        count: 0,
        highest_urgency: 0,
        notify: routeDef?.notify ?? false,
      };
    }
    summary[item.routed_to].count += 1;
    summary[item.routed_to].highest_urgency = Math.max(
      summary[item.routed_to].highest_urgency,
      item.urgency
    );
  }

  return summary;
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  const inputArg = argValue("--input");
  const outputArg = argValue("--output");
  const categoriesArg = argValue("--categories");
  const batchSizeArg = argValue("--batch-size");

  if (!inputArg || !outputArg) {
    console.error("Usage: --input <reports.json> --output <classification.json> [--categories <path>] [--batch-size <n>]");
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const outputPath = path.resolve(process.cwd(), outputArg);
  const batchSize = batchSizeArg ? parseInt(batchSizeArg, 10) : 5;

  // Load categories config
  const categoriesPath = categoriesArg
    ? path.resolve(process.cwd(), categoriesArg)
    : path.resolve(__dirname, "../references/categories.json");

  const config: CategoriesConfig = JSON.parse(fs.readFileSync(categoriesPath, "utf-8"));
  const validCategoryIds = new Set(config.categories.map((c) => c.id));

  // Load reports
  const reports: CommunityReport[] = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  console.log(`[community-classifier] Processing ${reports.length} reports in batches of ${batchSize}`);

  // Process in batches
  const allResults: Array<ClassificationResult & { routed_to: string }> = [];
  const systemPrompt = buildSystemPrompt();
  let llmCalls = 0;
  let totalTokensEstimate = 0;

  for (let i = 0; i < reports.length; i += batchSize) {
    const batch = reports.slice(i, i + batchSize);
    const userPrompt = buildUserPrompt(config.categories, batch);

    console.log(`[community-classifier] Batch ${Math.floor(i / batchSize) + 1}: classifying ${batch.length} reports...`);

    try {
      const rawResponse = await callLLM(systemPrompt, userPrompt);
      llmCalls += 1;

      // Parse response
      let cleaned = rawResponse.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }

      const parsed: LLMClassificationResponse = JSON.parse(cleaned);

      if (!Array.isArray(parsed.classifications)) {
        console.error(`[community-classifier] Batch ${Math.floor(i / batchSize) + 1}: LLM returned no classifications array`);
        continue;
      }

      // Validate and enrich each result
      for (const cls of parsed.classifications) {
        const validated = validateClassification(cls, validCategoryIds, config);
        const catDef = config.categories.find((c) => c.id === validated.category);
        allResults.push({
          ...validated,
          routed_to: catDef?.route_to ?? config.routing[config.default_category]?.label ?? "unknown",
        });
      }

      // Rough token estimate for metrics
      totalTokensEstimate += Math.round((systemPrompt.length + userPrompt.length + rawResponse.length) / 4);

    } catch (err) {
      console.error(`[community-classifier] Batch ${Math.floor(i / batchSize) + 1} failed:`, (err as Error).message);
      // Mark failed reports with low-confidence default classification
      for (const report of batch) {
        allResults.push({
          report_id: report.id,
          category: config.default_category,
          subcategory: "otro",
          urgency: 2,
          summary: `[Classification failed] ${report.text.slice(0, 80)}...`,
          location_normalized: report.location?.address_hint ?? null,
          confidence: 0,
          reasoning: `LLM call failed: ${(err as Error).message}`,
          routed_to: config.categories.find((c) => c.id === config.default_category)?.route_to ?? "unknown",
        });
      }
    }
  }

  // Build totals
  const totals: Record<string, number> = {};
  for (const cat of config.categories) {
    totals[cat.id] = 0;
  }
  for (const item of allResults) {
    totals[item.category] = (totals[item.category] ?? 0) + 1;
  }

  // Build routing summary
  const routingSummary = buildRoutingSummary(allResults, config);

  // Write report
  writeSkillReport(outputPath, "community-classifier", {
    totals,
    items: allResults,
    routing_summary: routingSummary,
  }, {
    metrics: {
      reportCount: reports.length,
      llmCalls,
      totalTokensEstimate,
      batchSize,
      categoriesVersion: config.version,
    },
  });

  console.log(`[community-classifier] Done. ${allResults.length} reports classified.`);
  console.log(`[community-classifier] Routing summary:`, JSON.stringify(routingSummary, null, 2));
}

main().catch((err) => {
  console.error("[community-classifier] Fatal error:", err);
  process.exit(1);
});
