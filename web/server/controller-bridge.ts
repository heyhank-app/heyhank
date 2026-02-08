import { ClaudeCodeController, parseMessage } from "claude-code-controller";
import type { InboxMessage, PlanApprovalRequestMessage, PermissionRequestMessage, ShutdownApprovedMessage } from "claude-code-controller";
import { WsManager } from "./ws-manager.js";
import type { AgentInfo, Approval, Message, SessionInfo } from "./types.js";
import { randomUUID } from "node:crypto";

const MAX_MESSAGES_PER_AGENT = 500;

export class ControllerBridge {
  private controller: ClaudeCodeController | null = null;
  private agents = new Map<string, AgentInfo>();
  private messages = new Map<string, Message[]>();
  private pendingApprovals = new Map<string, Approval>();
  readonly ws: WsManager;

  constructor() {
    this.ws = new WsManager();
  }

  get isInitialized(): boolean {
    return this.controller !== null;
  }

  get sessionInfo(): SessionInfo {
    return {
      initialized: this.controller !== null,
      teamName: this.controller?.teamName ?? "",
    };
  }

  getAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  getMessages(): Record<string, Message[]> {
    const result: Record<string, Message[]> = {};
    for (const [key, msgs] of this.messages) {
      result[key] = msgs;
    }
    return result;
  }

  getPendingApprovals(): Approval[] {
    return Array.from(this.pendingApprovals.values());
  }

  getController(): ClaudeCodeController {
    if (!this.controller) throw new Error("Controller not initialized");
    return this.controller;
  }

  async init(opts: {
    teamName?: string;
    cwd?: string;
    claudeBinary?: string;
    apiKey?: string;
    baseUrl?: string;
    env?: Record<string, string>;
  }): Promise<SessionInfo> {
    if (this.controller) {
      await this.controller.shutdown();
    }

    this.agents.clear();
    this.messages.clear();
    this.pendingApprovals.clear();

    // Merge first-class options into env (first-class wins)
    const env: Record<string, string> = {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      ...opts.env,
    };
    if (opts.apiKey) env.ANTHROPIC_AUTH_TOKEN = opts.apiKey;
    if (opts.baseUrl) env.ANTHROPIC_BASE_URL = opts.baseUrl;

    this.controller = new ClaudeCodeController({
      teamName: opts.teamName,
      cwd: opts.cwd,
      claudeBinary: opts.claudeBinary,
      env,
      logLevel: "debug",
    });

    this.wireEvents();
    await this.controller.init();

    const info = this.sessionInfo;
    this.ws.broadcast({ type: "session:initialized", teamName: info.teamName });
    return info;
  }

  async shutdown(): Promise<void> {
    if (this.controller) {
      await this.controller.shutdown();
      this.controller = null;
      this.agents.clear();
      this.messages.clear();
      this.pendingApprovals.clear();
      this.ws.broadcast({ type: "session:shutdown" });
    }
  }

  async spawnAgent(opts: {
    name: string;
    type?: string;
    model?: string;
    cwd?: string;
    permissions?: string;
    apiKey?: string;
    baseUrl?: string;
    env?: Record<string, string>;
  }): Promise<AgentInfo> {
    const ctrl = this.getController();

    // Merge first-class options into env
    const agentEnv: Record<string, string> = { ...opts.env };
    if (opts.apiKey) agentEnv.ANTHROPIC_AUTH_TOKEN = opts.apiKey;
    if (opts.baseUrl) agentEnv.ANTHROPIC_BASE_URL = opts.baseUrl;

    // Resolve permission preset
    const PRESET_MAP: Record<string, string> = {
      edit: "acceptEdits",
      plan: "plan",
      ask: "default",
    };
    const permissionMode = opts.permissions ? (PRESET_MAP[opts.permissions] as any) : undefined;

    const handle = await ctrl.spawnAgent({
      name: opts.name,
      type: opts.type,
      model: opts.model,
      cwd: opts.cwd,
      permissionMode,
      env: Object.keys(agentEnv).length > 0 ? agentEnv : undefined,
    });

    const info: AgentInfo = {
      name: opts.name,
      type: opts.type || "general-purpose",
      model: opts.model,
      pid: handle.pid,
      status: "running",
      spawnedAt: Date.now(),
    };

    this.agents.set(opts.name, info);
    this.messages.set(opts.name, []);
    return info;
  }

  addMessage(agentName: string, msg: Message) {
    if (!this.messages.has(agentName)) {
      this.messages.set(agentName, []);
    }
    const list = this.messages.get(agentName)!;
    list.push(msg);
    if (list.length > MAX_MESSAGES_PER_AGENT) {
      list.splice(0, list.length - MAX_MESSAGES_PER_AGENT);
    }
  }

  removeApproval(requestId: string) {
    this.pendingApprovals.delete(requestId);
  }

  private wireEvents() {
    const ctrl = this.controller!;

    ctrl.on("agent:spawned", (name, pid) => {
      const existing = this.agents.get(name);
      if (existing) {
        existing.pid = pid;
        existing.status = "running";
        this.ws.broadcast({ type: "agent:spawned", agent: { ...existing } });
      }
    });

    ctrl.on("agent:exited", (name, code) => {
      const agent = this.agents.get(name);
      if (agent) {
        agent.status = "exited";
        agent.exitCode = code;
      }
      this.ws.broadcast({ type: "agent:exited", agent: name, exitCode: code });
    });

    ctrl.on("idle", (name) => {
      const agent = this.agents.get(name);
      if (agent && agent.status !== "exited") {
        agent.status = "idle";
      }

      const msg: Message = {
        id: randomUUID(),
        from: name,
        text: "Agent is idle (finished turn)",
        timestamp: new Date().toISOString(),
        isSystem: true,
      };
      this.addMessage(name, msg);

      this.ws.broadcast({ type: "agent:idle", agent: name });
      this.ws.broadcast({ type: "agent:message", agent: name, message: msg });
    });

    ctrl.on("message", (name, raw: InboxMessage) => {
      const agent = this.agents.get(name);
      if (agent && agent.status !== "exited") {
        agent.status = "running";
      }

      const msg: Message = {
        id: randomUUID(),
        from: name,
        text: raw.text,
        timestamp: raw.timestamp,
        summary: raw.summary,
      };
      this.addMessage(name, msg);
      this.ws.broadcast({ type: "agent:message", agent: name, message: msg });
    });

    ctrl.on("shutdown:approved", (name, _parsed: ShutdownApprovedMessage) => {
      this.ws.broadcast({ type: "agent:shutdown_approved", agent: name });
    });

    ctrl.on("plan:approval_request", (name, parsed: PlanApprovalRequestMessage) => {
      const approval: Approval = {
        id: parsed.requestId,
        agent: name,
        type: "plan",
        timestamp: parsed.timestamp,
        planContent: parsed.planContent,
      };
      this.pendingApprovals.set(parsed.requestId, approval);
      this.ws.broadcast({ type: "approval:plan", approval });
    });

    ctrl.on("permission:request", (name, parsed: PermissionRequestMessage) => {
      const approval: Approval = {
        id: parsed.requestId,
        agent: name,
        type: "permission",
        timestamp: parsed.timestamp,
        toolName: parsed.toolName,
        description: parsed.description,
      };
      this.pendingApprovals.set(parsed.requestId, approval);
      this.ws.broadcast({ type: "approval:permission", approval });
    });

    ctrl.on("error", (err) => {
      this.ws.broadcast({ type: "error", message: err.message });
    });
  }
}
