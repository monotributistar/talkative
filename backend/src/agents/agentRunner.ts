import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { createApproval } from "../approval/store.js";
import { mirrorAgentEvent } from "../orchestrator/service.js";
import { getActiveRunForAgent } from "../orchestrator/store.js";
import { buildDeterministicContext, ContextEvent } from "../prompt/contextBuilder.js";
import { createPromptVersion, getActivePrompt } from "../prompt/store.js";
import { interpretConversation } from "../services/interpreter.js";
import { logRouterUsage } from "../router/service.js";
import { appendAgentEvent, readAgentEvents } from "./eventStore.js";
import { loadAgentSkills } from "./skillLoader.js";
import { runWorkspaceTool } from "./toolRunner.js";
import { AgentEvent, AgentMessageResponse, AgentRecord, AgentSkill } from "./types.js";
import { createPatchFromInterpretation } from "./workflowPatch.js";
import { ensureInside, exists } from "./utils.js";

interface AgentConfig {
  heartbeatMinutes?: number;
}

export class AgentRunner {
  private timer?: NodeJS.Timeout;
  private skills: AgentSkill[] = [];

  constructor(
    private agent: AgentRecord,
    private onAgentUpdate: (next: AgentRecord) => Promise<void>
  ) {}

  getAgent(): AgentRecord {
    return this.agent;
  }

  getSkills(): AgentSkill[] {
    return this.skills;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.agent.workspace, { recursive: true });
    await fs.mkdir(path.join(this.agent.workspace, "skills"), { recursive: true });
    await fs.mkdir(path.join(this.agent.workspace, "inputs"), { recursive: true });
    await fs.mkdir(path.join(this.agent.workspace, "outputs"), { recursive: true });

    const configPath = path.join(this.agent.workspace, "config.json");
    if (!(await exists(configPath))) {
      const config: AgentConfig = { heartbeatMinutes: this.agent.heartbeatMinutes };
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    }

    const heartbeatPath = path.join(this.agent.workspace, "HEARTBEAT.md");
    if (!(await exists(heartbeatPath))) {
      await fs.writeFile(
        heartbeatPath,
        [
          "# Heartbeat Tasks",
          "",
          "Use one command per line with prefix RUN.",
          "Example:",
          "RUN node skills/mail-triage/scripts/triageEmails.ts --input inputs/emails.sample.json --output outputs/triage-result.json"
        ].join("\n"),
        "utf8"
      );
    }

    this.skills = await loadAgentSkills(this.agent.workspace);

    const activePrompt = await getActivePrompt(this.agent.tenant_id, this.agent.agent_id);
    if (!activePrompt) {
      await createPromptVersion({
        tenant_id: this.agent.tenant_id,
        agent_id: this.agent.agent_id,
        template: "You are a business workflow subagent. Be concise, structured, and safe.",
        activate: true
      });
    }
  }

  async refreshSkills(): Promise<AgentSkill[]> {
    this.skills = await loadAgentSkills(this.agent.workspace);
    return this.skills;
  }

  private async emit(type: AgentEvent["type"], message: string, payload?: Record<string, unknown>): Promise<AgentEvent> {
    const saved = await appendAgentEvent({
      agentId: this.agent.id,
      agent_id: this.agent.agent_id,
      tenant_id: this.agent.tenant_id,
      type,
      message,
      payload
    });

    const run_id = typeof payload?.run_id === "string" ? payload.run_id : `session-${this.agent.agent_id}`;
    await mirrorAgentEvent({
      tenant_id: this.agent.tenant_id,
      agent_id: this.agent.agent_id,
      run_id,
      event_type: type,
      message,
      payload
    });

    return saved;
  }

  private async applyConfig(): Promise<void> {
    const configPath = path.join(this.agent.workspace, "config.json");
    try {
      const raw = await fs.readFile(configPath, "utf8");
      const parsed = JSON.parse(raw) as AgentConfig;
      if (parsed.heartbeatMinutes && parsed.heartbeatMinutes > 0) {
        this.agent.heartbeatMinutes = parsed.heartbeatMinutes;
      }
    } catch {
      // Keep current config if file is missing or malformed.
    }
  }

  private scheduleHeartbeat(): void {
    if (this.timer) clearInterval(this.timer);
    const intervalMs = this.agent.heartbeatMinutes * 60_000;
    this.timer = setInterval(() => {
      void this.runHeartbeat("scheduled");
    }, intervalMs);
  }

  async start(): Promise<void> {
    await this.initialize();
    await this.applyConfig();
    this.scheduleHeartbeat();

    this.agent.status = "running";
    this.agent.updatedAt = new Date().toISOString();
    await this.onAgentUpdate(this.agent);
    await this.emit("AGENT_STARTED", `Agent ${this.agent.name} started`, {
      heartbeatMinutes: this.agent.heartbeatMinutes
    });
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    this.agent.status = "stopped";
    this.agent.updatedAt = new Date().toISOString();
    await this.onAgentUpdate(this.agent);
    await this.emit("AGENT_STOPPED", `Agent ${this.agent.name} stopped`);
  }

  async runHeartbeat(reason: "scheduled" | "manual"): Promise<AgentEvent[]> {
    // Skip heartbeat when agent has an active paused run.
    const activeRun = await getActiveRunForAgent(this.agent.tenant_id, this.agent.agent_id);
    if (activeRun && activeRun.status === "paused") {
      return [await this.emit("HEARTBEAT_TICK", `Heartbeat skipped: run ${activeRun.run_id} is ${activeRun.status}`, { reason, skipped: true, run_id: activeRun.run_id })];
    }

    const emitted: AgentEvent[] = [];
    const heartbeatPath = path.join(this.agent.workspace, "HEARTBEAT.md");
    let content = "";

    try {
      content = await fs.readFile(heartbeatPath, "utf8");
    } catch {
      emitted.push(await this.emit("HEARTBEAT_TICK", "Heartbeat skipped: HEARTBEAT.md missing", { reason }));
      return emitted;
    }

    const commands = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("RUN "))
      .map((line) => line.slice(4));

    this.agent.lastHeartbeatAt = new Date().toISOString();
    this.agent.updatedAt = new Date().toISOString();
    await this.onAgentUpdate(this.agent);

    emitted.push(
      await this.emit("HEARTBEAT_TICK", `Heartbeat triggered (${reason})`, {
        commandCount: commands.length
      })
    );

    for (const command of commands) {
      try {
        emitted.push(await this.emit("TOOL_RUN_STARTED", `Tool run started: ${command}`));
        const result = await runWorkspaceTool(this.agent.workspace, command);
        emitted.push(
          await this.emit("TOOL_RUN_FINISHED", result.ok ? `Tool executed: ${command}` : `Tool failed: ${command}`, {
            ok: result.ok,
            error: result.error,
            metrics: result.metrics,
            artifacts: result.artifacts
          })
        );
        emitted.push(
          await this.emit("METRIC_RECORDED", "Tool metric recorded", {
            command,
            runMs: result.metrics.duration_ms,
            exitCode: result.metrics.exit_code
          })
        );
      } catch (error) {
        emitted.push(
          await this.emit("TOOL_RUN_FINISHED", `Tool rejected: ${command}`, {
            error: (error as Error).message,
            ok: false
          })
        );
      }
    }

    return emitted;
  }

  async handleMessage(message: string): Promise<AgentMessageResponse> {
    // Check if agent has a paused run — reject messages if so
    const activeRun = await getActiveRunForAgent(this.agent.tenant_id, this.agent.agent_id);
    if (activeRun && activeRun.status === "paused") {
      return {
        agentId: this.agent.id,
        reply: `Agent ${this.agent.name} is paused (run ${activeRun.run_id}). Resume the run before sending messages.`,
        actions: [{ type: "agent.paused", data: { run_id: activeRun.run_id, status: activeRun.status } }],
        events: []
      };
    }

    const startedAt = Date.now();
    const run_id = `run-${nanoid(8)}`;
    const events: AgentEvent[] = [];

    const now = new Date().toISOString();
    this.agent.lastMessageAt = now;
    this.agent.lastMessage = message;
    this.agent.updatedAt = now;
    await this.onAgentUpdate(this.agent);

    events.push(await this.emit("MESSAGE_RECEIVED", message, { run_id }));

    const recent = await readAgentEvents(this.agent.id, 8);
    const activePrompt = await getActivePrompt(this.agent.tenant_id, this.agent.agent_id);
    const context = buildDeterministicContext({
      promptTemplate: activePrompt?.template ?? "You are a business workflow subagent.",
      userMessage: message,
      skills: this.skills.map((s) => s.id),
      recentEvents: recent.map((row): ContextEvent => ({
        type: row.type,
        message: row.message,
        ...(row.payload ? { payload: row.payload } : {})
      })),
      maxTokens: 700,
      variables: {
        agent_name: this.agent.name,
        agent_id: this.agent.agent_id,
        tenant_id: this.agent.tenant_id
      }
    });

    const interpretation = interpretConversation(message);
    events.push(
      await this.emit("INTERPRETATION_RESULT", "Interpretation generated", {
        run_id,
        detectedTasks: interpretation.detectedTasks,
        context_tokens: context.token_estimate,
        context_truncated: context.truncated
      })
    );

    const workflowPatch = createPatchFromInterpretation(interpretation, 0);
    events.push(
      await this.emit("WORKFLOW_PATCH_PROPOSED", "Workflow patch proposed from conversation", {
        run_id,
        patchId: workflowPatch.id,
        operations: workflowPatch.operations.length
      })
    );

    const actions: AgentMessageResponse["actions"] = [];
    let reply = `Agent ${this.agent.name} interpreted ${interpretation.detectedTasks.length} task(s).`;

    const lower = message.toLowerCase();
    const sensitive =
      lower.includes("transfer") || lower.includes("wire") || lower.includes("refund") || lower.includes("delete");
    if (sensitive) {
      const approval = await createApproval({
        tenant_id: this.agent.tenant_id,
        agent_id: this.agent.agent_id,
        run_id,
        reason: `Sensitive action detected in message: ${message}`
      });
      actions.push({ type: "human_approval_required", data: { approval_id: approval.id, reason: approval.reason } });
      reply += ` Human approval required (approval_id=${approval.id}).`;
    }

    if (lower.includes("heartbeat") && (lower.includes("run") || lower.includes("now"))) {
      const heartbeatEvents = await this.runHeartbeat("manual");
      events.push(...heartbeatEvents);
      actions.push({ type: "heartbeat.executed", data: { count: heartbeatEvents.length } });
      reply += " Heartbeat executed.";
    }

    // ── Community classifier skill trigger ──
    const hasCommunitySkill = this.skills.some((skill) => skill.id === "community-classifier");
    if (hasCommunitySkill && (lower.includes("clasificar") || lower.includes("classify") || lower.includes("reportes") || lower.includes("reports") || lower.includes("denuncias"))) {
      const command =
        "node skills/community-classifier/scripts/classifyReports.ts --input inputs/pending-reports.json --output outputs/classification-report.json";
      try {
        events.push(await this.emit("TOOL_RUN_STARTED", "Community classifier started", { run_id, command }));
        const result = await runWorkspaceTool(this.agent.workspace, command);

        if (result.ok) {
          actions.push({ type: "tool.executed", data: { command, output: "outputs/classification-report.json" } });
          reply += " Community classification completed — wrote outputs/classification-report.json.";

          // Auto-mark classified reports so the pending queue is cleared
          try {
            const { getLatestClassification, markReportsClassified } = await import("../community/store.js");
            const report = await getLatestClassification(this.agent.workspace);
            if (report?.data?.items?.length) {
              const ids = report.data.items.map((i: { report_id: string }) => i.report_id);
              await markReportsClassified(this.agent.workspace, ids);
            }
          } catch {
            // Best-effort — don't break the flow if marking fails
          }
        } else {
          actions.push({ type: "tool.failed", data: { command } });
          reply += " Community classification failed.";
        }

        events.push(
          await this.emit("TOOL_RUN_FINISHED", result.ok ? "Community classifier executed" : "Community classifier failed", {
            run_id,
            command,
            ok: result.ok,
            error: result.error,
            metrics: result.metrics,
            artifacts: result.artifacts,
            skillReport: result.skillReport
          })
        );
        events.push(
          await this.emit("METRIC_RECORDED", "Community classifier metric recorded", {
            run_id,
            command,
            runMs: result.metrics.duration_ms,
            exitCode: result.metrics.exit_code
          })
        );
      } catch (error) {
        actions.push({ type: "tool.failed", data: { command } });
        events.push(
          await this.emit("TOOL_RUN_FINISHED", "Community classifier rejected", {
            run_id,
            error: (error as Error).message,
            ok: false
          })
        );
        reply += " Community classifier command rejected by safety rules.";
      }
    }

    const hasMailSkill = this.skills.some((skill) => skill.id === "mail-triage");
    if (hasMailSkill && (lower.includes("triage") || lower.includes("email"))) {
      const command =
        "node skills/mail-triage/scripts/triageEmails.ts --input inputs/emails.sample.json --output outputs/triage-result.json";
      try {
        events.push(await this.emit("TOOL_RUN_STARTED", "Mail triage tool started", { run_id, command }));
        const result = await runWorkspaceTool(this.agent.workspace, command);

        if (result.ok) {
          actions.push({ type: "tool.executed", data: { command, output: "outputs/triage-result.json" } });
          reply += " Mail triage completed and wrote outputs/triage-result.json.";
        } else {
          actions.push({ type: "tool.failed", data: { command } });
          reply += " Mail triage failed.";
        }

        events.push(
          await this.emit("TOOL_RUN_FINISHED", result.ok ? "Mail triage skill executed" : "Mail triage skill failed", {
            run_id,
            command,
            ok: result.ok,
            error: result.error,
            metrics: result.metrics,
            artifacts: result.artifacts
          })
        );
        events.push(
          await this.emit("METRIC_RECORDED", "Mail triage metric recorded", {
            run_id,
            command,
            runMs: result.metrics.duration_ms,
            exitCode: result.metrics.exit_code
          })
        );
      } catch (error) {
        actions.push({ type: "tool.failed", data: { command } });
        events.push(
          await this.emit("TOOL_RUN_FINISHED", "Mail triage rejected", {
            run_id,
            error: (error as Error).message,
            ok: false
          })
        );
        reply += " Mail triage command rejected by safety rules.";
      }
    }

    events.push(
      await this.emit("WORKFLOW_PATCH_APPLIED", "Workflow patch accepted in session", {
        run_id,
        patchId: workflowPatch.id
      })
    );

    const response: AgentMessageResponse = {
      agentId: this.agent.id,
      reply,
      interpretation,
      workflowPatch,
      actions,
      events
    };

    await logRouterUsage({
      tenant_id: this.agent.tenant_id,
      agent_id: this.agent.agent_id,
      prompt: message,
      latency_ms: Date.now() - startedAt,
      status: "ok"
    });

    return response;
  }

  async runCommand(command: string): Promise<void> {
    ensureInside(this.agent.workspace, ".");
    await runWorkspaceTool(this.agent.workspace, command);
  }
}
