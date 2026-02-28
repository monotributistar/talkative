export type AgentStatus = "running" | "stopped";

export type AgentEventType =
  | "MESSAGE_RECEIVED"
  | "INTERPRETATION_RESULT"
  | "WORKFLOW_PATCH_PROPOSED"
  | "WORKFLOW_PATCH_APPLIED"
  | "TOOL_RUN_STARTED"
  | "TOOL_RUN_FINISHED"
  | "METRIC_RECORDED"
  | "HEARTBEAT_TICK"
  | "AGENT_CREATED"
  | "AGENT_STARTED"
  | "AGENT_STOPPED"
  | "SKILL_ATTACHED";

export interface AgentRecord {
  id: string;
  agent_id: string;
  tenant_id: string;
  name: string;
  workspace: string;
  status: AgentStatus;
  heartbeatMinutes: number;
  /** Template used to create this agent (e.g. "community-classifier") */
  template?: string;
  lastHeartbeatAt?: string;
  lastMessageAt?: string;
  lastMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  path: string;
}

export interface AgentEvent {
  id: string;
  agent_id: string;
  tenant_id: string;
  agentId: string;
  type: AgentEventType;
  message: string;
  payload?: Record<string, unknown>;
  timestamp: string;
}

export interface WorkflowPatchNode {
  id: string;
  name: string;
  description?: string;
}

export interface WorkflowPatchEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowPatchOperation {
  op: "add_node" | "update_node" | "remove_node" | "add_edge" | "update_edge" | "remove_edge";
  node?: WorkflowPatchNode;
  edge?: WorkflowPatchEdge;
  id?: string;
}

export interface WorkflowPatch {
  id: string;
  version: number;
  createdAt: string;
  operations: WorkflowPatchOperation[];
  snapshot?: {
    nodes: WorkflowPatchNode[];
    edges: WorkflowPatchEdge[];
  };
}

export interface AgentMessageResponse {
  agentId: string;
  reply: string;
  interpretation?: {
    detectedTasks: string[];
    suggestions: unknown[];
  };
  workflowPatch?: WorkflowPatch;
  actions: Array<{ type: string; data?: Record<string, unknown> }>;
  events: AgentEvent[];
}
