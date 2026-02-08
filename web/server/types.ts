// Shared types for WebSocket and REST communication

export interface AgentInfo {
  name: string;
  type: string;
  model?: string;
  pid?: number;
  status: "running" | "idle" | "exited";
  exitCode?: number | null;
  spawnedAt: number;
}

export interface Approval {
  id: string; // requestId
  agent: string;
  type: "plan" | "permission";
  timestamp: string;
  // plan-specific
  planContent?: string;
  // permission-specific
  toolName?: string;
  description?: string;
}

export interface Message {
  id: string;
  from: string; // agent name or "you"
  text: string;
  timestamp: string;
  summary?: string;
  isSystem?: boolean; // for idle notifications, etc.
}

// WebSocket events (server → client)
export interface StatusLineInfo {
  model?: string;
  contextUsedPercent?: number;
  costUsd?: number;
  durationMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
  sessionId?: string;
}

export type WsEvent =
  | { type: "snapshot"; session: SessionInfo; agents: AgentInfo[]; messages: Record<string, Message[]>; pendingApprovals: Approval[] }
  | { type: "session:initialized"; teamName: string }
  | { type: "session:shutdown" }
  | { type: "agent:spawned"; agent: AgentInfo }
  | { type: "agent:exited"; agent: string; exitCode: number | null }
  | { type: "agent:idle"; agent: string }
  | { type: "agent:message"; agent: string; message: Message }
  | { type: "agent:statusline"; agent: string; statusline: StatusLineInfo }
  | { type: "agent:shutdown_approved"; agent: string }
  | { type: "approval:plan"; approval: Approval }
  | { type: "approval:permission"; approval: Approval }
  | { type: "error"; message: string };

export interface SessionInfo {
  initialized: boolean;
  teamName: string;
}
