import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { ClaudeCodeController } from "./controller.js";
import type { AgentHandle } from "./agent-handle.js";
import type {
  LogLevel,
  Logger,
  AgentType,
  PermissionMode,
  InboxMessage,
  PermissionRequestMessage,
  PlanApprovalRequestMessage,
} from "./types.js";

// Polyfill for Node < 20.4
(Symbol as any).asyncDispose ??= Symbol("Symbol.asyncDispose");

// ─── Types ──────────────────────────────────────────────────────────────────

export type PermissionPreset = "full" | "edit" | "plan" | "ask";

export interface ClaudeOptions {
  /** Model to use: "sonnet" | "opus" | "haiku" | full model ID */
  model?: "sonnet" | "opus" | "haiku" | (string & {});
  /** Anthropic API key. Maps to ANTHROPIC_AUTH_TOKEN env var. */
  apiKey?: string;
  /** API base URL. Maps to ANTHROPIC_BASE_URL env var. */
  baseUrl?: string;
  /** Request timeout in ms. Maps to API_TIMEOUT_MS env var. */
  timeout?: number;
  /** Working directory for the agent. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * Permission level:
   * - "full" (default) — all tools, no approval needed
   * - "edit" — auto-approve read/write/bash
   * - "plan" — read-only exploration
   * - "ask" — fires permission events for each tool use
   */
  permissions?: PermissionPreset;
  /**
   * Auto-approve permission and plan requests.
   * - `true` — approve everything automatically
   * - `string[]` — only auto-approve these tool names, reject the rest
   *
   * Only meaningful with `permissions: "ask"`. Ignored when "full" or "edit".
   *
   * @example
   * ```ts
   * // Approve everything
   * await claude.agent({ permissions: "ask", autoApprove: true });
   *
   * // Only approve safe tools
   * await claude.agent({ permissions: "ask", autoApprove: ["Read", "Glob", "Grep"] });
   * ```
   */
  autoApprove?: boolean | string[];
  /**
   * Inline callback for permission requests.
   * Called when the agent wants to use a tool.
   * Provides `req.approve()` / `req.reject()` methods.
   *
   * @example
   * ```ts
   * await claude.agent({
   *   permissions: "ask",
   *   onPermission: (req) => {
   *     req.toolName === "Bash" ? req.reject() : req.approve();
   *   },
   * });
   * ```
   */
  onPermission?: (request: PermissionRequestInfo) => void;
  /**
   * Inline callback for plan approval requests.
   * Called when the agent submits a plan for review.
   *
   * @example
   * ```ts
   * await claude.agent({
   *   onPlan: (req) => {
   *     console.log(req.planContent);
   *     req.approve();
   *   },
   * });
   * ```
   */
  onPlan?: (request: PlanRequestInfo) => void;
  /** Additional environment variables (escape hatch). */
  env?: Record<string, string>;
  /** Log level. Defaults to "warn" for the simplified API. */
  logLevel?: LogLevel;
  /** Custom logger instance. */
  logger?: Logger;
  /** Agent name. Auto-generated if omitted. */
  name?: string;
  /** Agent type. Defaults to "general-purpose". */
  type?: AgentType;
  /** Path to the claude binary. */
  claudeBinary?: string;
  /** Max time in ms to wait for agent to become ready. Default: 60_000. */
  readyTimeout?: number;
}

export interface AskOptions {
  /** Response timeout in ms. Default: 120_000. */
  timeout?: number;
  /** Poll interval in ms. Default: 500. */
  pollInterval?: number;
}

export interface SessionOptions extends ClaudeOptions {
  /** Team name. Auto-generated if omitted. */
  teamName?: string;
}

export interface SessionAgentOptions {
  /** Model override for this agent. */
  model?: string;
  /** Working directory override. */
  cwd?: string;
  /** Agent type override. */
  type?: AgentType;
  /** Permission preset override. */
  permissions?: PermissionPreset;
  /** Auto-approve permission/plan requests. See ClaudeOptions.autoApprove. */
  autoApprove?: boolean | string[];
  /** Inline permission callback. See ClaudeOptions.onPermission. */
  onPermission?: (request: PermissionRequestInfo) => void;
  /** Inline plan callback. See ClaudeOptions.onPlan. */
  onPlan?: (request: PlanRequestInfo) => void;
  /** Per-agent env overrides. */
  env?: Record<string, string>;
  /** Max time in ms to wait for agent to become ready. Default: 60_000. */
  readyTimeout?: number;
}

export interface PermissionRequestInfo {
  requestId: string;
  toolName: string;
  description: string;
  input?: unknown;
  approve(): Promise<void>;
  reject(): Promise<void>;
}

export interface PlanRequestInfo {
  requestId: string;
  planContent?: string;
  approve(feedback?: string): Promise<void>;
  reject(feedback: string): Promise<void>;
}

export interface AgentEvents {
  message: [text: string];
  idle: [];
  permission: [request: PermissionRequestInfo];
  plan: [request: PlanRequestInfo];
  exit: [code: number | null];
  error: [error: Error];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildEnv(opts: ClaudeOptions): Record<string, string> {
  const env: Record<string, string> = { ...opts.env };
  // First-class options override env keys
  if (opts.apiKey) env.ANTHROPIC_AUTH_TOKEN = opts.apiKey;
  if (opts.baseUrl) env.ANTHROPIC_BASE_URL = opts.baseUrl;
  if (opts.timeout != null) env.API_TIMEOUT_MS = String(opts.timeout);
  return env;
}

function resolvePermissions(
  preset?: PermissionPreset
): { permissionMode?: PermissionMode } {
  switch (preset) {
    case "edit":
      return { permissionMode: "acceptEdits" };
    case "plan":
      return { permissionMode: "plan" };
    case "ask":
      return { permissionMode: "default" };
    case "full":
    default:
      // Don't pass --permission-mode flag at all for "full" —
      // the CLI default already allows everything and skipping
      // the flag avoids issues with idle detection.
      return { permissionMode: undefined };
  }
}

function waitForReady(
  controller: ClaudeCodeController,
  agentName: string,
  timeoutMs = 15_000
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(
        new Error(
          `Agent "${agentName}" did not become ready within ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    // Resolve early on idle or message — agent is confirmed responsive
    const onReady = (name: string, ..._rest: any[]) => {
      if (name === agentName && !settled) {
        settled = true;
        cleanup();
        resolve();
      }
    };

    const onExit = (name: string, code: number | null) => {
      if (name === agentName && !settled) {
        settled = true;
        cleanup();
        reject(
          new Error(
            `Agent "${agentName}" exited before becoming ready (code=${code})`
          )
        );
      }
    };

    // Resolve when the agent process is confirmed running.
    // Claude Code agents don't reliably send idle_notification on initial boot,
    // so we also listen for agent:spawned to resolve after the process starts.
    const onSpawned = (name: string) => {
      if (name === agentName && !settled) {
        settled = true;
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      controller.removeListener("idle", onReady);
      controller.removeListener("message", onReady);
      controller.removeListener("agent:spawned", onSpawned);
      controller.removeListener("agent:exited", onExit);
    };

    controller.on("idle", onReady);
    controller.on("message", onReady);
    controller.on("agent:spawned", onSpawned);
    controller.on("agent:exited", onExit);
  });
}

// ─── Agent ──────────────────────────────────────────────────────────────────

/** Options that affect agent behavior (callbacks & auto-approve). */
interface AgentBehavior {
  autoApprove?: boolean | string[];
  onPermission?: (request: PermissionRequestInfo) => void;
  onPlan?: (request: PlanRequestInfo) => void;
}

export class Agent extends EventEmitter<AgentEvents> {
  private controller: ClaudeCodeController;
  private handle: AgentHandle;
  private ownsController: boolean;
  private disposed = false;
  private boundListeners: Array<{ event: string; fn: (...args: any[]) => void }> = [];

  private constructor(
    controller: ClaudeCodeController,
    handle: AgentHandle,
    ownsController: boolean,
    behavior?: AgentBehavior
  ) {
    super();
    this.controller = controller;
    this.handle = handle;
    this.ownsController = ownsController;
    this.wireEvents();
    this.wireBehavior(behavior);
  }

  /** Create a standalone agent (owns its own controller). */
  static async create(opts: ClaudeOptions = {}): Promise<Agent> {
    const name = opts.name ?? `agent-${randomUUID().slice(0, 8)}`;
    const env = buildEnv(opts);
    const { permissionMode } = resolvePermissions(opts.permissions);

    const controller = new ClaudeCodeController({
      teamName: `claude-${randomUUID().slice(0, 8)}`,
      cwd: opts.cwd,
      claudeBinary: opts.claudeBinary,
      env,
      logLevel: opts.logLevel ?? "warn",
      logger: opts.logger,
    });

    await controller.init();

    // Set up ready detection BEFORE spawning so we don't miss the idle event
    const ready = waitForReady(controller, name, opts.readyTimeout);

    try {
      const handle = await controller.spawnAgent({
        name,
        type: opts.type ?? "general-purpose",
        model: opts.model,
        cwd: opts.cwd,
        permissionMode,
      });

      const agent = new Agent(controller, handle, true, {
        autoApprove: opts.autoApprove,
        onPermission: opts.onPermission,
        onPlan: opts.onPlan,
      });
      await ready;
      return agent;
    } catch (err) {
      await controller.shutdown().catch(() => {});
      throw err;
    }
  }

  /** Create an agent within an existing session (session owns the controller). */
  static async createInSession(
    controller: ClaudeCodeController,
    name: string,
    opts: SessionAgentOptions = {}
  ): Promise<Agent> {
    const { permissionMode } = resolvePermissions(opts.permissions);
    const ready = waitForReady(controller, name, opts.readyTimeout);

    const handle = await controller.spawnAgent({
      name,
      type: opts.type ?? "general-purpose",
      model: opts.model,
      cwd: opts.cwd,
      permissionMode,
      env: opts.env,
    });

    const agent = new Agent(controller, handle, false, {
      autoApprove: opts.autoApprove,
      onPermission: opts.onPermission,
      onPlan: opts.onPlan,
    });
    await ready;
    return agent;
  }

  /** The agent's name. */
  get name(): string {
    return this.handle.name;
  }

  /** The agent process PID. */
  get pid(): number | undefined {
    return this.handle.pid;
  }

  /** Whether the agent process is still running. */
  get isRunning(): boolean {
    return this.handle.isRunning;
  }

  /**
   * Send a message and wait for the response.
   *
   * Uses event-based waiting (via the controller's InboxPoller) instead of
   * polling `readUnread()` directly, which avoids a race condition where the
   * poller marks inbox messages as read before `receive()` can see them.
   */
  async ask(question: string, opts?: AskOptions): Promise<string> {
    this.ensureNotDisposed();
    const timeout = opts?.timeout ?? 120_000;

    // Register listener BEFORE sending so we don't miss the response
    const responsePromise = new Promise<string>((resolve, reject) => {
      let gotMessage = false;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout (${timeout}ms) waiting for response`));
      }, timeout);

      const onMsg = (text: string) => {
        gotMessage = true;
        cleanup();
        resolve(text);
      };
      const onIdle = () => {
        // Agent finished its turn. If a message was already received, ignore.
        // Otherwise the agent went idle without sending a message — resolve
        // with empty string so the caller doesn't hang forever.
        if (!gotMessage) {
          cleanup();
          resolve("");
        }
      };
      const onExit = (code: number | null) => {
        cleanup();
        reject(new Error(`Agent exited (code=${code}) before responding`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener("message", onMsg);
        this.removeListener("idle", onIdle);
        this.removeListener("exit", onExit);
      };

      this.on("message", onMsg);
      this.on("idle", onIdle);
      this.on("exit", onExit);
    });

    // Agents in teammate mode don't always use SendMessage unprompted.
    // Append a reminder so responses come back through the inbox reliably.
    const wrapped = `${question}\n\nIMPORTANT: You MUST send your complete answer back using the SendMessage tool. Do NOT just think your answer — use the SendMessage tool to reply.`;
    await this.handle.send(wrapped);
    return responsePromise;
  }

  /** Send a message without waiting for a response. */
  async send(message: string): Promise<void> {
    this.ensureNotDisposed();
    return this.handle.send(message);
  }

  /** Wait for the next response from this agent. */
  async receive(opts?: AskOptions): Promise<string> {
    this.ensureNotDisposed();
    const timeout = opts?.timeout ?? 120_000;

    return new Promise<string>((resolve, reject) => {
      let gotMessage = false;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout (${timeout}ms) waiting for response`));
      }, timeout);

      const onMsg = (text: string) => {
        gotMessage = true;
        cleanup();
        resolve(text);
      };
      const onIdle = () => {
        if (!gotMessage) {
          cleanup();
          resolve("");
        }
      };
      const onExit = (code: number | null) => {
        cleanup();
        reject(new Error(`Agent exited (code=${code}) before responding`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener("message", onMsg);
        this.removeListener("idle", onIdle);
        this.removeListener("exit", onExit);
      };

      this.on("message", onMsg);
      this.on("idle", onIdle);
      this.on("exit", onExit);
    });
  }

  /**
   * Close this agent. If standalone, shuts down the entire controller.
   * If session-owned, kills only this agent's process.
   */
  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unwireEvents();

    if (this.ownsController) {
      await this.controller.shutdown();
    } else {
      await this.handle.kill();
    }
  }

  /** Mark as disposed (used by Session when it closes). */
  markDisposed(): void {
    this.disposed = true;
    this.unwireEvents();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private wireEvents(): void {
    const agentName = this.handle.name;

    const onMessage = (name: string, msg: InboxMessage) => {
      if (name === agentName) this.emit("message", msg.text);
    };
    const onIdle = (name: string, _details: any) => {
      if (name === agentName) this.emit("idle");
    };
    const onPermission = (name: string, parsed: PermissionRequestMessage) => {
      if (name !== agentName) return;
      let handled = false;
      const guard = (fn: () => Promise<void>) => () => {
        if (handled) return Promise.resolve();
        handled = true;
        return fn();
      };
      this.emit("permission", {
        requestId: parsed.requestId,
        toolName: parsed.toolName,
        description: parsed.description,
        input: parsed.input,
        approve: guard(() =>
          this.controller.sendPermissionResponse(agentName, parsed.requestId, true)
        ),
        reject: guard(() =>
          this.controller.sendPermissionResponse(agentName, parsed.requestId, false)
        ),
      });
    };
    const onPlan = (name: string, parsed: PlanApprovalRequestMessage) => {
      if (name !== agentName) return;
      let handled = false;
      const guard = (fn: (...a: any[]) => Promise<void>) => (...args: any[]) => {
        if (handled) return Promise.resolve();
        handled = true;
        return fn(...args);
      };
      this.emit("plan", {
        requestId: parsed.requestId,
        planContent: parsed.planContent,
        approve: guard((feedback?: string) =>
          this.controller.sendPlanApproval(agentName, parsed.requestId, true, feedback)
        ),
        reject: guard((feedback: string) =>
          this.controller.sendPlanApproval(agentName, parsed.requestId, false, feedback)
        ),
      });
    };
    const onExit = (name: string, code: number | null) => {
      if (name === agentName) this.emit("exit", code);
    };
    const onError = (err: Error) => {
      this.emit("error", err);
    };

    this.controller.on("message", onMessage);
    this.controller.on("idle", onIdle);
    this.controller.on("permission:request", onPermission);
    this.controller.on("plan:approval_request", onPlan);
    this.controller.on("agent:exited", onExit);
    this.controller.on("error", onError);

    this.boundListeners = [
      { event: "message", fn: onMessage },
      { event: "idle", fn: onIdle },
      { event: "permission:request", fn: onPermission },
      { event: "plan:approval_request", fn: onPlan },
      { event: "agent:exited", fn: onExit },
      { event: "error", fn: onError },
    ];
  }

  private unwireEvents(): void {
    for (const { event, fn } of this.boundListeners) {
      this.controller.removeListener(event, fn);
    }
    this.boundListeners = [];
  }

  private wireBehavior(behavior?: AgentBehavior): void {
    if (!behavior) return;

    const { autoApprove, onPermission, onPlan } = behavior;

    // autoApprove: wire up automatic permission and plan handling
    if (autoApprove != null) {
      this.on("permission", (req) => {
        if (autoApprove === true) {
          req.approve();
        } else if (Array.isArray(autoApprove)) {
          autoApprove.includes(req.toolName) ? req.approve() : req.reject();
        }
      });

      // autoApprove also auto-approves plans
      if (autoApprove === true) {
        this.on("plan", (req) => req.approve());
      }
    }

    // Inline callbacks (run after autoApprove, so they can override)
    if (onPermission) {
      this.on("permission", onPermission);
    }
    if (onPlan) {
      this.on("plan", onPlan);
    }
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Agent has been closed");
    }
  }
}

// ─── Session ────────────────────────────────────────────────────────────────

export class Session {
  readonly controller: ClaudeCodeController;
  private defaults: SessionOptions;
  private agents = new Map<string, Agent>();
  private disposed = false;

  private constructor(
    controller: ClaudeCodeController,
    defaults: SessionOptions
  ) {
    this.controller = controller;
    this.defaults = defaults;
  }

  static async create(opts: SessionOptions = {}): Promise<Session> {
    const env = buildEnv(opts);
    const controller = new ClaudeCodeController({
      teamName: opts.teamName ?? `session-${randomUUID().slice(0, 8)}`,
      cwd: opts.cwd,
      claudeBinary: opts.claudeBinary,
      env,
      logLevel: opts.logLevel ?? "warn",
      logger: opts.logger,
    });

    await controller.init();
    return new Session(controller, opts);
  }

  /** Spawn a named agent in this session. Inherits session defaults. */
  async agent(name: string, opts: SessionAgentOptions = {}): Promise<Agent> {
    this.ensureNotDisposed();

    const merged: SessionAgentOptions = {
      model: this.defaults.model,
      cwd: this.defaults.cwd,
      permissions: this.defaults.permissions,
      readyTimeout: this.defaults.readyTimeout,
      autoApprove: this.defaults.autoApprove,
      onPermission: this.defaults.onPermission,
      onPlan: this.defaults.onPlan,
      ...opts,
    };

    const agent = await Agent.createInSession(
      this.controller,
      name,
      merged
    );
    this.agents.set(name, agent);
    return agent;
  }

  /** Get an existing agent by name. */
  get(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  /** Close all agents and shut down the session. */
  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    for (const agent of this.agents.values()) {
      agent.markDisposed();
    }

    await this.controller.shutdown();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Session has been closed");
    }
  }
}

// ─── claude() ───────────────────────────────────────────────────────────────

/**
 * One-liner: send a prompt, get a response.
 * Creates an ephemeral agent, sends the message, returns the answer, cleans up.
 *
 * @example
 * ```ts
 * const answer = await claude("What does this project do?", { model: "sonnet" });
 * ```
 */
async function claudeCall(
  prompt: string,
  opts: ClaudeOptions = {}
): Promise<string> {
  const agent = await Agent.create(opts);
  try {
    return await agent.ask(prompt, { timeout: opts.timeout ?? 120_000 });
  } finally {
    await agent.close();
  }
}

/**
 * The simplified Claude Code API.
 *
 * - `claude(prompt, opts?)` — one-liner: ask a question, get an answer
 * - `claude.agent(opts?)` — create a persistent agent for multi-turn conversations
 * - `claude.session(opts?)` — create a multi-agent session
 */
export const claude = Object.assign(claudeCall, {
  /**
   * Create a persistent agent for multi-turn conversations.
   *
   * @example
   * ```ts
   * const agent = await claude.agent({ model: "sonnet" });
   * const answer = await agent.ask("What is 2+2?");
   * await agent.close();
   * ```
   */
  agent: (opts?: ClaudeOptions) => Agent.create(opts),

  /**
   * Create a multi-agent session.
   *
   * @example
   * ```ts
   * const session = await claude.session({ model: "sonnet" });
   * const reviewer = await session.agent("reviewer", { model: "opus" });
   * const coder = await session.agent("coder");
   * await session.close();
   * ```
   */
  session: (opts?: SessionOptions) => Session.create(opts),
});

// Re-export helpers for testing
export { buildEnv, resolvePermissions, waitForReady };
