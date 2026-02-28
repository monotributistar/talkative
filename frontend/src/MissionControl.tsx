import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  attachSkill,
  createAgent,
  decideApproval,
  getAgentEvents,
  getAgentSkills,
  getApprovals,
  listAgents,
  sendAgentMessage,
  startAgent,
  stopAgent
} from "./api";
import { AgentEvent, AgentRecord, AgentSkill, ApprovalRequest } from "./types";

const TEMPLATE_OPTIONS = ["mail-triage", "git-watcher", "monthly-bookkeeping", "community-classifier"] as const;
const SKILL_OPTIONS = ["mail-triage", "git-watcher", "monthly-bookkeeping", "community-classifier"] as const;

export default function MissionControl() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [status, setStatus] = useState("Mission Control ready");
  const [lastPatchInfo, setLastPatchInfo] = useState<string>("");
  const [chatInput, setChatInput] = useState("");
  const [agentName, setAgentName] = useState("Mail Assistant");
  const [template, setTemplate] = useState<(typeof TEMPLATE_OPTIONS)[number]>("mail-triage");
  const [skillToAttach, setSkillToAttach] = useState<(typeof SKILL_OPTIONS)[number]>("mail-triage");

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  async function refreshAgents(): Promise<void> {
    const payload = await listAgents();
    setAgents(payload.agents);

    if (!selectedAgentId && payload.agents.length > 0) {
      setSelectedAgentId(payload.agents[0].id);
    }
  }

  async function refreshAgentDetails(agentId: string): Promise<void> {
    const selected = agents.find((agent) => agent.id === agentId);
    const [skillsPayload, eventsPayload, approvalsPayload] = await Promise.all([
      getAgentSkills(agentId),
      getAgentEvents(agentId, 80),
      getApprovals({
        tenant_id: selected?.tenant_id ?? "tenant-default",
        agent_id: selected?.agent_id ?? agentId,
        status: "pending",
        limit: 20
      })
    ]);
    setSkills(skillsPayload.skills);
    setEvents(eventsPayload.events);
    setApprovals(approvalsPayload.approvals);
  }

  useEffect(() => {
    void refreshAgents();
    const timer = setInterval(() => {
      void refreshAgents();
      if (selectedAgentId) {
        void refreshAgentDetails(selectedAgentId);
      }
    }, 4000);

    return () => clearInterval(timer);
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) return;
    void refreshAgentDetails(selectedAgentId);
  }, [selectedAgentId]);

  async function onCreateAgent(event: FormEvent) {
    event.preventDefault();
    try {
      const id = `agent-${agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || Date.now()}`;
      const created = await createAgent({ id, name: agentName, template });
      setSelectedAgentId(created.id);
      setStatus(`Created ${created.name}`);
      await refreshAgents();
      await refreshAgentDetails(created.id);
    } catch (error) {
      setStatus(`Create failed: ${(error as Error).message}`);
    }
  }

  async function onToggleRunning(agent: AgentRecord) {
    try {
      if (agent.status === "running") {
        await stopAgent(agent.id);
        setStatus(`Stopped ${agent.name}`);
      } else {
        await startAgent(agent.id);
        setStatus(`Started ${agent.name}`);
      }

      await refreshAgents();
      await refreshAgentDetails(agent.id);
    } catch (error) {
      setStatus(`Start/stop failed: ${(error as Error).message}`);
    }
  }

  async function onAttachSkill() {
    if (!selectedAgentId) return;
    try {
      const result = await attachSkill(selectedAgentId, skillToAttach);
      setSkills(result.skills);
      setStatus(`Attached ${skillToAttach}`);
      await refreshAgentDetails(selectedAgentId);
    } catch (error) {
      setStatus(`Attach failed: ${(error as Error).message}`);
    }
  }

  async function onSendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedAgentId || !chatInput.trim()) return;

    try {
      const response = await sendAgentMessage(selectedAgentId, chatInput.trim());
      const patchOps = response.workflowPatch?.operations.length ?? 0;
      setStatus(response.reply);
      setLastPatchInfo(
        response.workflowPatch
          ? `Patch ${response.workflowPatch.id} proposed with ${patchOps} operation(s).`
          : "No workflow patch proposed."
      );
      setChatInput("");
      await refreshAgentDetails(selectedAgentId);
    } catch (error) {
      setStatus(`Message failed: ${(error as Error).message}`);
    }
  }

  async function onDecision(approvalId: string, decision: "approved" | "rejected") {
    if (!selectedAgent) return;
    try {
      await decideApproval({
        id: approvalId,
        operator_id: "monotributistar",
        decision
      });
      setStatus(`Approval ${approvalId} ${decision}`);
      await refreshAgentDetails(selectedAgent.id);
    } catch (error) {
      setStatus(`Decision failed: ${(error as Error).message}`);
    }
  }

  return (
    <div className="mission-grid">
      <aside className="mission-sidebar">
        <div className="card">
          <h2>Create Agent</h2>
          <form className="form-grid" onSubmit={onCreateAgent}>
            <label>
              Name
              <input value={agentName} onChange={(event) => setAgentName(event.target.value)} />
            </label>
            <label>
              Template
              <select value={template} onChange={(event) => setTemplate(event.target.value as (typeof TEMPLATE_OPTIONS)[number])}>
                {TEMPLATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Create Agent</button>
          </form>
        </div>

        <div className="card">
          <h2>Agents</h2>
          <div className="agent-list">
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={`agent-row ${selectedAgentId === agent.id ? "active" : ""}`}
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <strong>{agent.name}</strong>
                <span>{agent.status}</span>
                <span className="muted">last hb: {agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).toLocaleString() : "-"}</span>
              </button>
            ))}
            {agents.length === 0 && <p>No agents yet.</p>}
          </div>
        </div>
      </aside>

      <section className="mission-main">
        <div className="card">
          <h2>Agent Details</h2>
          {!selectedAgent && <p>Select an agent.</p>}
          {selectedAgent && (
            <div className="details-grid">
              <div>
                <p>
                  <strong>ID:</strong> {selectedAgent.id}
                </p>
                <p>
                  <strong>Workspace:</strong> {selectedAgent.workspace}
                </p>
                <p>
                  <strong>Last message:</strong> {selectedAgent.lastMessage ?? "-"}
                </p>
              </div>
              <div className="button-row">
                <button onClick={() => onToggleRunning(selectedAgent)}>
                  {selectedAgent.status === "running" ? "Stop Agent" : "Start Agent"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Skills</h2>
          <div className="button-row">
            <select value={skillToAttach} onChange={(event) => setSkillToAttach(event.target.value as (typeof SKILL_OPTIONS)[number])}>
              {SKILL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button onClick={onAttachSkill} disabled={!selectedAgentId}>
              Attach Skill
            </button>
          </div>
          <ul>
            {skills.map((skill) => (
              <li key={skill.id}>
                <strong>{skill.name}</strong> - {skill.description}
              </li>
            ))}
            {skills.length === 0 && <li>No skills loaded.</li>}
          </ul>
        </div>

        <div className="card">
          <h2>Chat With Agent</h2>
          <form className="form-grid" onSubmit={onSendMessage}>
            <textarea
              rows={3}
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Example: triage the inbox now"
            />
            <button type="submit" disabled={!selectedAgentId}>
              Send Message
            </button>
          </form>
        </div>

        <div className="card event-log">
          <h2>Event Log</h2>
          <div className="events-scroll">
            {events.map((entry) => (
              <div key={entry.id} className="event-row">
                <span className="muted">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <strong>{entry.type}</strong>
                <span>{entry.message}</span>
              </div>
            ))}
            {events.length === 0 && <p>No events yet.</p>}
          </div>
        </div>

        <div className="card">
          <h2>Pending Approvals</h2>
          {approvals.length === 0 && <p>No pending approvals.</p>}
          {approvals.map((approval) => (
            <div key={approval.id} className="event-row">
              <strong>{approval.id}</strong>
              <span>{approval.reason}</span>
              <span className="muted">run: {approval.run_id}</span>
              <div className="button-row">
                <button onClick={() => onDecision(approval.id, "approved")}>Approve</button>
                <button className="secondary" onClick={() => onDecision(approval.id, "rejected")}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>

        <p className="status">{status}</p>
        {lastPatchInfo && <p className="status">{lastPatchInfo}</p>}
      </section>
    </div>
  );
}
