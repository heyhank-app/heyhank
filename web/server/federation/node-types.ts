// ─── Federation Types ──────────────────────────────────────────────────────────
// Peer-to-peer WebSocket mesh for multi-node HeyHank connectivity.

export interface NodeIdentity {
  nodeId: string;
  name: string;
  createdAt: string;
}

export interface NodeConfig {
  id: string;
  url: string;
  secret: string;
  name: string;
  addedAt: string;
}

export interface NodeStatus extends NodeConfig {
  connected: boolean;
  inboundConnected: boolean;
  remoteNodeId: string | null;
  remoteName: string | null;
  sessionCount: number;
}

// ─── Protocol Messages ────────────────────────────────────────────────────────

export type NodeMessage =
  | NodeAuthMessage
  | NodeAuthOkMessage
  | NodeAuthErrorMessage
  | NodePingMessage
  | NodePongMessage
  | NodeSessionsRequestMessage
  | NodeSessionsSyncMessage
  | NodeSessionProxyMessage
  | NodeSessionProxyResponseMessage
  | NodeAgentsSyncMessage;

export interface NodeAuthMessage {
  type: "auth";
  nodeId: string;
  name: string;
  secret: string;
  version: number;
}

export interface NodeAuthOkMessage {
  type: "auth_ok";
  nodeId: string;
  name: string;
  version: number;
}

export interface NodeAuthErrorMessage {
  type: "auth_error";
  error: string;
}

export interface NodePingMessage {
  type: "ping";
}

export interface NodePongMessage {
  type: "pong";
}

export interface NodeSessionsRequestMessage {
  type: "sessions_request";
}

export interface NodeSessionsSyncMessage {
  type: "sessions_sync";
  sessions: RemoteSessionSummary[];
}

export interface NodeSessionProxyMessage {
  type: "session_proxy";
  requestId: string;
  sessionId: string;
  text: string;
}

export interface NodeSessionProxyResponseMessage {
  type: "session_proxy_response";
  requestId: string;
  result?: { replyText: string };
  error?: string;
}

export interface NodeAgentsSyncMessage {
  type: "agents_sync";
  agents: RemoteAgentSummary[];
}

// ─── Remote Summaries ─────────────────────────────────────────────────────────

export interface RemoteSessionSummary {
  sessionId: string;
  name?: string;
  model?: string;
  cwd?: string;
  status?: string;
  backendType?: string;
  isConnected?: boolean;
}

export interface RemoteAgentSummary {
  id: string;
  name: string;
  description?: string;
  backendType?: string;
  status?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PROTOCOL_VERSION = 1;
export const PING_INTERVAL_MS = 30_000;
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
