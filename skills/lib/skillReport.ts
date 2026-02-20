/**
 * Shared skill report utility.
 *
 * Every skill script should use `writeSkillReport()` to produce its output.
 * This ensures a consistent envelope that the ToolRunner and AgentRunner can
 * rely on without having to guess the shape of each skill's output.
 *
 * The envelope wraps whatever domain-specific payload the skill produces
 * (e.g. triage items, git status, bookkeeping totals) inside a standard
 * metadata layer: `ok`, `generatedAt`, `skillName`, and `metrics`.
 *
 * Usage (inside a skill script):
 *
 *   import { writeSkillReport } from "../../lib/skillReport.js";
 *
 *   const payload = { totals, items };
 *   writeSkillReport(outputPath, "mail-triage", payload);
 */

import fs from "node:fs";
import path from "node:path";

export interface SkillReportEnvelope<T = unknown> {
  /** Whether the skill considers its own execution successful. */
  ok: boolean;
  /** ISO-8601 timestamp of report generation. */
  generatedAt: string;
  /** Identifier matching the skill folder name. */
  skillName: string;
  /** Domain-specific result produced by the skill. */
  data: T;
  /** Optional performance or diagnostic metrics. */
  metrics?: Record<string, unknown>;
  /** Present only when ok === false. */
  error?: { code: string; message: string };
}

/**
 * Build and write a standardized skill report to `outputPath`.
 *
 * @param outputPath  Absolute or CWD-relative path for the JSON output file.
 * @param skillName   Skill identifier (should match the template folder name).
 * @param data        The domain-specific payload.
 * @param opts        Optional overrides (ok, metrics, error).
 */
export function writeSkillReport<T>(
  outputPath: string,
  skillName: string,
  data: T,
  opts?: { ok?: boolean; metrics?: Record<string, unknown>; error?: { code: string; message: string } }
): void {
  const report: SkillReportEnvelope<T> = {
    ok: opts?.ok ?? true,
    generatedAt: new Date().toISOString(),
    skillName,
    data,
    ...(opts?.metrics ? { metrics: opts.metrics } : {}),
    ...(opts?.error ? { error: opts.error } : {})
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[${skillName}] Wrote report to: ${outputPath}`);
}
