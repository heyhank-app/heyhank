// ─── Node Manager ─────────────────────────────────────────────────────────────
// Orchestrates all federation connections. Singleton.

import type { ServerWebSocket } from "bun";
import { randomUUID } from "node:crypto";
import type {
  NodeMessage,
  NodeStatus,
  RemoteSessionSummary,
  RemoteAgentSummary,
  NodeSessionProxyMessage,
  NodeSessionProxyResponseMessage,
} from "./node-types.js";
import { PROTOCOL_VERSION, PING_INTERVAL_MS } from "./node-types.js";
import { getNodeIdentity, listNodes, getNode } from "./node-store.js";
import { NodeConnection } from "./node-connection.js";

interface InboundPeer {
  ws: WebSocket | ServerWebSocket<unknown>;
  nodeId: string;
  name: string;
  sessions: RemoteSessionSummary[];
  lastPong: number;
  pingTimer: ReturnType<typeof setInterval> | null;
}

type ProxyCallback = (result: { result?: { replyText: string }; error?: string }) => void;

export class NodeManager {
  /** Outbound connections keyed by node config ID */
  private outbound = new Map<string, NodeConnection>();
  /** Inbound connections keyed by remote node ID */
  private inbound = new Map<string, InboundPeer>();
  /** Pending proxy requests */
  private pendingProxies = new Map<string, ProxyCallback>();

  /** Provider: returns local session summaries for syncing */
  getLocalSessions: (() => RemoteSessionSummary[]) | null = null;
  /** Provider: handles a proxy request (runs command on local session) */
  proxyHandler: ((sessionId: string, text: string) => Promise<{ replyText: string }>) | null = null;

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  initialize(): void {
    const nodes = listNodes();
    for (const node of nodes) {
      this.connectNode(node.id);
    }
    console.log(`[federation] Initialized with ${nodes.length} configured node(s)`);
  }

  shutdown(): void {
    for (const conn of this.outbound.values()) conn.destroy();
    this.outbound.clear();
    for (const info of this.inbound.values()) {
      if (info.pingTimer) clearInterval(info.pingTimer);
      try { (info.ws as WebSocket).close?.(); } catch { /* ignore */ }
    }
    this.inbound.clear();
  }

  connectNode(nodeConfigId: string): void {
    if (this.outbound.has(nodeConfigId)) return;
    const config = getNode(nodeConfigId);
    if (!config) return;
    const conn = new NodeConnection(config, this);
    this.outbound.set(nodeConfigId, conn);
    conn.connect();
  }

  disconnectNode(nodeConfigId: string): void {
    const conn = this.outbound.get(nodeConfigId);
    if (conn) {
      conn.destroy();
      this.outbound.delete(nodeConfigId);
    }
  }

  // ─── Inbound WebSocket handling ─────────────────────────────────────────────

  handleInboundConnection(ws: WebSocket | ServerWebSocket<unknown>): void {
    let authTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      try { (ws as WebSocket).close?.(); } catch { /* ignore */ }
    }, 10_000);

    let authed = false;
    const sendJson = (msg: NodeMessage) => {
      try {
        const payload = JSON.stringify(msg);
        ws.send(payload);
      } catch { /* ignore */ }
    };

    const onMessage = (data: string | Buffer | ArrayBuffer) => {
      let msg: NodeMessage;
      try {
        msg = JSON.parse(typeof data === "string" ? data : data.toString()) as NodeMessage;
      } catch { return; }

      if (!authed) {
        if (msg.type !== "auth") {
          try { (ws as WebSocket).close?.(); } catch { /* ignore */ }
          return;
        }
        if (authTimeout) { clearTimeout(authTimeout); authTimeout = null; }

        // Verify secret against any configured node
        const nodes = listNodes();
        const match = nodes.find((n) => n.secret === msg.secret);
        if (!match) {
          sendJson({ type: "auth_error", error: "invalid secret" });
          setTimeout(() => { try { (ws as WebSocket).close?.(); } catch { /* ignore */ } }, 100);
          return;
        }

        authed = true;
        const identity = getNodeIdentity();

        // Replace any old inbound from same nodeId
        const old = this.inbound.get(msg.nodeId);
        if (old) {
          if (old.pingTimer) clearInterval(old.pingTimer);
          try { (old.ws as WebSocket).close?.(); } catch { /* ignore */ }
        }

        const info: InboundPeer = {
          ws,
          nodeId: msg.nodeId,
          name: msg.name || "Unknown",
          sessions: [],
          lastPong: Date.now(),
          pingTimer: null,
        };
        this.inbound.set(msg.nodeId, info);

        sendJson({ type: "auth_ok", nodeId: identity.nodeId, name: identity.name, version: PROTOCOL_VERSION });

        // Start ping
        info.pingTimer = setInterval(() => {
          if (Date.now() - info.lastPong > PING_INTERVAL_MS * 3) {
            console.log(`[federation] Inbound ping timeout for ${info.name}`);
            try { (ws as WebSocket).close?.(); } catch { /* ignore */ }
            return;
          }
          sendJson({ type: "ping" });
        }, PING_INTERVAL_MS);

        console.log(`[federation] Inbound connection from ${info.name} (${info.nodeId})`);

        // Send our sessions
        sendJson({ type: "sessions_sync", sessions: this.getLocalSessionSummaries() });
        return;
      }

      // Find inbound peer by ws reference
      const peer = [...this.inbound.values()].find((i) => i.ws === ws);
      if (!peer) return;

      switch (msg.type) {
        case "pong":
          peer.lastPong = Date.now();
          break;
        case "ping":
          sendJson({ type: "pong" });
          break;
        case "sessions_request":
          sendJson({ type: "sessions_sync", sessions: this.getLocalSessionSummaries() });
          break;
        case "sessions_sync":
          peer.sessions = msg.sessions ?? [];
          break;
        case "session_proxy":
          this.handleProxyRequest({ sendMsg: sendJson }, msg);
          break;
        case "session_proxy_response":
          if (msg.requestId) this.resolveProxy(msg.requestId, msg);
          break;
      }
    };

    // Bun ServerWebSocket uses `.data` property and events are handled via the global websocket handler,
    // but for the federation inbound we store the handler and call it from index.ts
    // Store message handler on the ws object for retrieval
    (ws as unknown as Record<string, unknown>).__federationOnMessage = onMessage;
    (ws as unknown as Record<string, unknown>).__federationOnClose = () => {
      if (authTimeout) clearTimeout(authTimeout);
      for (const [nodeId, info] of this.inbound) {
        if (info.ws === ws) {
          if (info.pingTimer) clearInterval(info.pingTimer);
          this.inbound.delete(nodeId);
          console.log(`[federation] Inbound disconnected: ${info.name}`);
          break;
        }
      }
    };
  }

  // ─── Session summaries ──────────────────────────────────────────────────────

  getLocalSessionSummaries(): RemoteSessionSummary[] {
    return this.getLocalSessions?.() ?? [];
  }

  getRemoteSessions(): (RemoteSessionSummary & { nodeId: string; nodeName: string })[] {
    const sessions: (RemoteSessionSummary & { nodeId: string; nodeName: string })[] = [];
    const seen = new Set<string>();

    for (const conn of this.outbound.values()) {
      if (!conn.connected) continue;
      for (const s of conn.remoteSessions) {
        const key = `${conn.remoteNodeId}:${s.sessionId}`;
        if (!seen.has(key)) {
          seen.add(key);
          sessions.push({ ...s, nodeId: conn.remoteNodeId!, nodeName: conn.remoteName! });
        }
      }
    }

    for (const info of this.inbound.values()) {
      for (const s of info.sessions) {
        const key = `${info.nodeId}:${s.sessionId}`;
        if (!seen.has(key)) {
          seen.add(key);
          sessions.push({ ...s, nodeId: info.nodeId, nodeName: info.name });
        }
      }
    }

    return sessions;
  }

  getRemoteAgents(): (RemoteAgentSummary & { nodeId: string; nodeName: string })[] {
    const agents: (RemoteAgentSummary & { nodeId: string; nodeName: string })[] = [];
    // Agents sync is not yet implemented in the protocol, but return empty for now
    // This will be populated when agents_sync messages are exchanged
    return agents;
  }

  // ─── Node statuses ──────────────────────────────────────────────────────────

  getNodeStatuses(): NodeStatus[] {
    const nodes = listNodes();
    return nodes.map((n) => {
      const conn = this.outbound.get(n.id);
      const connected = conn?.connected ?? false;
      const remoteNodeId = conn?.remoteNodeId ?? null;
      const remoteName = conn?.remoteName ?? null;
      const sessionCount = conn?.remoteSessions.length ?? 0;
      const inboundConnected = remoteNodeId ? this.inbound.has(remoteNodeId) : false;

      return {
        ...n,
        connected,
        inboundConnected,
        remoteNodeId,
        remoteName,
        sessionCount,
      };
    });
  }

  // ─── Proxy ──────────────────────────────────────────────────────────────────

  async sendToRemoteSession(sessionId: string, text: string): Promise<{ result?: { replyText: string }; error?: string }> {
    // Find in outbound
    for (const conn of this.outbound.values()) {
      if (!conn.connected) continue;
      if (conn.remoteSessions.some((s) => s.sessionId === sessionId)) {
        return this.proxyVia(
          (msg) => conn.sendMsg(msg),
          sessionId,
          text,
        );
      }
    }
    // Find in inbound
    for (const info of this.inbound.values()) {
      if (info.sessions.some((s) => s.sessionId === sessionId)) {
        return this.proxyVia(
          (msg) => { try { info.ws.send(JSON.stringify(msg)); } catch { /* ignore */ } },
          sessionId,
          text,
        );
      }
    }
    return { error: "session not found on any remote node" };
  }

  private proxyVia(
    send: (msg: NodeMessage) => void,
    sessionId: string,
    text: string,
  ): Promise<{ result?: { replyText: string }; error?: string }> {
    return new Promise((resolve) => {
      const requestId = randomUUID();
      const timeout = setTimeout(() => {
        this.pendingProxies.delete(requestId);
        resolve({ error: "proxy timeout" });
      }, 120_000);

      this.pendingProxies.set(requestId, (result) => {
        clearTimeout(timeout);
        resolve(result);
      });

      send({ type: "session_proxy", requestId, sessionId, text });
    });
  }

  resolveProxy(requestId: string, msg: NodeSessionProxyResponseMessage): void {
    const cb = this.pendingProxies.get(requestId);
    if (cb) {
      this.pendingProxies.delete(requestId);
      cb(msg.error ? { error: msg.error } : { result: msg.result });
    }
  }

  async handleProxyRequest(
    sender: { sendMsg: (msg: NodeMessage) => void },
    msg: NodeSessionProxyMessage,
  ): Promise<void> {
    if (!this.proxyHandler) {
      sender.sendMsg({ type: "session_proxy_response", requestId: msg.requestId, error: "no proxy handler" });
      return;
    }
    try {
      const result = await this.proxyHandler(msg.sessionId, msg.text);
      sender.sendMsg({ type: "session_proxy_response", requestId: msg.requestId, result });
    } catch (err) {
      sender.sendMsg({
        type: "session_proxy_response",
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Events ─────────────────────────────────────────────────────────────────

  onNodeConnected(conn: NodeConnection): void {
    conn.sendMsg({ type: "sessions_sync", sessions: this.getLocalSessionSummaries() });
  }

  onNodeDisconnected(conn: NodeConnection): void {
    conn.remoteSessions = [];
  }

  onSessionsUpdated(): void {
    // Future: emit event bus events
  }

  broadcastLocalSessions(): void {
    const sessions = this.getLocalSessionSummaries();
    const msg: NodeMessage = { type: "sessions_sync", sessions };
    for (const conn of this.outbound.values()) {
      if (conn.connected) conn.sendMsg(msg);
    }
    for (const info of this.inbound.values()) {
      try { info.ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const nodeManager = new NodeManager();
