// ─── Node Connection ──────────────────────────────────────────────────────────
// Single outbound WebSocket to a peer node.
// Modeled on server/relay-client.ts: auth frame, exponential backoff, ping/pong.

import type { NodeConfig, NodeMessage, RemoteSessionSummary } from "./node-types.js";
import { PROTOCOL_VERSION, PING_INTERVAL_MS, RECONNECT_MIN_MS, RECONNECT_MAX_MS } from "./node-types.js";
import { getNodeIdentity } from "./node-store.js";
import type { NodeManager } from "./node-manager.js";

export class NodeConnection {
  readonly config: NodeConfig;
  private manager: NodeManager;
  private ws: WebSocket | null = null;

  remoteNodeId: string | null = null;
  remoteName: string | null = null;
  connected = false;
  authenticated = false;
  remoteSessions: RemoteSessionSummary[] = [];

  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private destroyed = false;

  constructor(config: NodeConfig, manager: NodeManager) {
    this.config = config;
    this.manager = manager;
  }

  connect(): void {
    if (this.destroyed) return;
    this.cleanup();

    const wsUrl = this.config.url.replace(/^http/, "ws") + "/ws/node";
    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      console.log(`[federation] WS create error for ${this.config.name}: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener("open", () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      const identity = getNodeIdentity();
      this.sendMsg({
        type: "auth",
        nodeId: identity.nodeId,
        name: identity.name,
        secret: this.config.secret,
        version: PROTOCOL_VERSION,
      });
    });

    this.ws.addEventListener("message", (event: MessageEvent) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as NodeMessage;
        this.handleMessage(msg);
      } catch { /* malformed */ }
    });

    this.ws.addEventListener("close", () => {
      this.onDisconnect();
    });

    this.ws.addEventListener("error", () => {
      // Close event follows — reconnect handled there
    });
  }

  private handleMessage(msg: NodeMessage): void {
    if (msg.type === "auth_ok") {
      this.authenticated = true;
      this.connected = true;
      this.remoteNodeId = msg.nodeId;
      this.remoteName = msg.name;
      this.lastPong = Date.now();
      this.startPing();
      console.log(`[federation] Connected to ${this.remoteName} (${this.remoteNodeId})`);
      this.sendMsg({ type: "sessions_request" });
      this.manager.onNodeConnected(this);
      return;
    }

    if (msg.type === "auth_error") {
      console.log(`[federation] Auth rejected by ${this.config.name}: ${msg.error}`);
      // Don't reconnect on auth failure — secret is wrong
      this.destroy();
      return;
    }

    if (!this.authenticated) return;

    switch (msg.type) {
      case "pong":
        this.lastPong = Date.now();
        break;
      case "ping":
        this.sendMsg({ type: "pong" });
        break;
      case "sessions_request":
        this.sendMsg({
          type: "sessions_sync",
          sessions: this.manager.getLocalSessionSummaries(),
        });
        break;
      case "sessions_sync":
        this.remoteSessions = msg.sessions ?? [];
        this.manager.onSessionsUpdated();
        break;
      case "session_proxy":
        this.manager.handleProxyRequest(this, msg);
        break;
      case "session_proxy_response":
        if (msg.requestId) {
          this.manager.resolveProxy(msg.requestId, msg);
        }
        break;
    }
  }

  sendMsg(msg: NodeMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastPong > PING_INTERVAL_MS * 3) {
        console.log(`[federation] Ping timeout for ${this.config.name}`);
        this.ws?.close();
        return;
      }
      this.sendMsg({ type: "ping" });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private onDisconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.authenticated = false;
    this.stopPing();
    this.cleanup();
    if (wasConnected) {
      console.log(`[federation] Disconnected from ${this.config.name}`);
      this.manager.onNodeDisconnected(this);
    }
    if (!this.destroyed) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    const jitter = Math.random() * 500;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.connect();
    }, this.reconnectDelay + jitter);
  }

  private cleanup(): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    this.connected = false;
    this.authenticated = false;
  }
}
