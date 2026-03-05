// ─── Chat SDK Integration Layer ─────────────────────────────────────────────
// Bridges Vercel Chat SDK with Companion's agent execution system.
// External platforms (Linear, GitHub, Slack, etc.) send webhooks to the Chat SDK,
// which routes them to registered handlers. These handlers create/resume agent
// sessions and relay responses back to the platform.
//
// Architecture: Per-agent Chat SDK instances. Each agent with chat platform
// credentials gets its own Chat SDK instance with isolated webhook handlers.
// A legacy global instance is maintained for backward compatibility with
// env-var based setup (deprecated).

import { Chat, ConsoleLogger } from "chat";
import type { Adapter, Thread, Message as ChatMessage } from "chat";
import { createLinearAdapter } from "@chat-adapter/linear";
import { createMemoryState } from "@chat-adapter/state-memory";
import type { AgentExecutor } from "./agent-executor.js";
import type { WsBridge } from "./ws-bridge.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import * as agentStore from "./agent-store.js";
import type { AgentConfig, ChatAdapterName, ChatPlatformBinding } from "./agent-types.js";

type WebhookHandler = (req: Request, opts?: { waitUntil?: (task: Promise<unknown>) => void }) => Promise<Response>;

/** State stored per-thread in the Chat SDK state adapter */
interface CompanionThreadState {
  /** Companion session ID linked to this thread */
  sessionId: string;
  /** Agent ID that handles this thread */
  agentId: string;
}

/** Per-agent Chat SDK runtime with isolated webhook handlers */
interface AgentChatRuntime {
  agentId: string;
  chat: Chat<Record<string, Adapter>, CompanionThreadState>;
  /** Platform names this runtime handles */
  platforms: string[];
  /** Adapter name → webhook handler */
  webhookHandlers: Record<string, WebhookHandler>;
}

/** Extract text from assistant message content blocks */
function extractTextFromAssistant(msg: BrowserIncomingMessage): string {
  if (msg.type !== "assistant") return "";
  const content = (msg as { message?: { content?: unknown[] } }).message?.content;
  if (!Array.isArray(content)) return "";
  return (content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

/**
 * Create a Chat SDK adapter for a platform binding's credentials.
 * Returns null if the adapter/credentials combination is not supported.
 */
function createAdapterForBinding(binding: ChatPlatformBinding): Adapter | null {
  if (!binding.credentials) return null;

  if (binding.adapter === "linear") {
    const creds = binding.credentials as { apiKey?: string; clientId?: string; clientSecret?: string; accessToken?: string; webhookSecret: string; userName?: string };
    // Need at least one auth method + webhook secret
    const hasAuth = creds.apiKey || (creds.clientId && creds.clientSecret) || creds.accessToken;
    if (!hasAuth || !creds.webhookSecret) return null;

    const adapterConfig: Record<string, unknown> = {
      webhookSecret: creds.webhookSecret,
      userName: creds.userName || "companion",
    };
    if (creds.apiKey) adapterConfig.apiKey = creds.apiKey;
    if (creds.clientId) adapterConfig.clientId = creds.clientId;
    if (creds.clientSecret) adapterConfig.clientSecret = creds.clientSecret;
    if (creds.accessToken) adapterConfig.accessToken = creds.accessToken;

    return createLinearAdapter(adapterConfig as Parameters<typeof createLinearAdapter>[0]);
  }

  // GitHub and other adapters: not yet implemented at runtime
  // Schema is forward-compatible; runtime support added when adapter packages are available
  return null;
}

export class ChatBot {
  /** Per-agent Chat SDK runtimes. Key = agentId */
  private runtimes = new Map<string, AgentChatRuntime>();

  /** Legacy global Chat SDK instance for env-var based setup (deprecated) */
  private legacyChat: Chat<Record<string, Adapter>, CompanionThreadState> | null = null;

  private sessionUnsubscribers = new Map<string, Array<() => void>>();
  private agentExecutor: AgentExecutor;
  private wsBridge: WsBridge;

  constructor(agentExecutor: AgentExecutor, wsBridge: WsBridge) {
    this.agentExecutor = agentExecutor;
    this.wsBridge = wsBridge;
  }

  /**
   * Initialize Chat SDK instances:
   * 1. Legacy global instance from env vars (deprecated fallback)
   * 2. Per-agent instances from agent chat credentials
   * Returns true if at least one adapter was initialized.
   */
  initialize(): boolean {
    let anyInitialized = false;

    // ── Legacy global instance from env vars (deprecated) ──
    if (process.env.LINEAR_API_KEY && process.env.LINEAR_WEBHOOK_SECRET) {
      const adapters: Record<string, Adapter> = {};
      adapters.linear = createLinearAdapter({
        apiKey: process.env.LINEAR_API_KEY,
        webhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
        userName: process.env.LINEAR_BOT_USERNAME || "companion",
      });

      this.legacyChat = new Chat<Record<string, Adapter>, CompanionThreadState>({
        userName: process.env.LINEAR_BOT_USERNAME || "companion",
        adapters,
        state: createMemoryState(),
        logger: new ConsoleLogger("warn"),
      });

      this.registerLegacyHandlers();
      anyInitialized = true;

      console.warn(
        "[chat-bot] Using deprecated global LINEAR_API_KEY/LINEAR_WEBHOOK_SECRET env vars. " +
        "Migrate to per-agent credentials in the agent editor.",
      );
    }

    // ── Per-agent instances from stored credentials ──
    const agents = agentStore.listAgents();
    for (const agent of agents) {
      if (this.initializeAgentRuntime(agent)) {
        anyInitialized = true;
      }
    }

    return anyInitialized;
  }

  /**
   * Initialize a per-agent Chat SDK runtime from the agent's chat platform credentials.
   * Returns true if a runtime was created.
   */
  initializeAgentRuntime(agent: AgentConfig): boolean {
    if (!agent.enabled) return false;
    if (!agent.triggers?.chat?.enabled) return false;

    const bindings = agent.triggers.chat.platforms || [];
    const adapters: Record<string, Adapter> = {};

    for (const binding of bindings) {
      const adapter = createAdapterForBinding(binding);
      if (adapter) {
        adapters[binding.adapter] = adapter;
      }
    }

    if (Object.keys(adapters).length === 0) return false;

    // Determine bot username from first binding that has one
    const userName = bindings.find((b) => {
      const creds = b.credentials as { userName?: string } | undefined;
      return creds?.userName;
    })?.credentials as { userName?: string } | undefined;

    const chat = new Chat<Record<string, Adapter>, CompanionThreadState>({
      userName: userName?.userName || "companion",
      adapters,
      state: createMemoryState(),
      logger: new ConsoleLogger("warn"),
    });

    // Register handlers scoped to this agent (no agent lookup needed)
    chat.onNewMention(async (thread: Thread<CompanionThreadState>, message: ChatMessage) => {
      await this.handleAgentMention(agent.id, thread, message);
    });

    chat.onSubscribedMessage(async (thread: Thread<CompanionThreadState>, message: ChatMessage) => {
      await this.handleAgentSubscribedMessage(agent.id, thread, message);
    });

    const webhookHandlers = chat.webhooks as Record<string, WebhookHandler>;

    this.runtimes.set(agent.id, {
      agentId: agent.id,
      chat,
      platforms: Object.keys(adapters),
      webhookHandlers,
    });

    console.log(
      `[chat-bot] Initialized agent-scoped chat runtime for "${agent.name}" (${agent.id}): ${Object.keys(adapters).join(", ")}`,
    );

    return true;
  }

  /**
   * Reload the Chat SDK runtime for a specific agent.
   * Called after agent create/update/toggle to pick up credential changes.
   */
  async reloadAgent(agentId: string): Promise<void> {
    // Shut down existing runtime if any
    await this.removeAgent(agentId);

    // Re-initialize from current agent config
    const agent = agentStore.getAgent(agentId);
    if (agent) {
      this.initializeAgentRuntime(agent);
    }
  }

  /**
   * Remove and shut down the Chat SDK runtime for a specific agent.
   */
  async removeAgent(agentId: string): Promise<void> {
    const runtime = this.runtimes.get(agentId);
    if (runtime) {
      await runtime.chat.shutdown();
      this.runtimes.delete(agentId);
      console.log(`[chat-bot] Removed chat runtime for agent "${agentId}"`);
    }
  }

  /**
   * Get the webhook handler for a specific agent + platform combination.
   * Used by the agent-scoped webhook route.
   */
  getWebhookHandler(agentId: string, platform: string): WebhookHandler | null {
    const runtime = this.runtimes.get(agentId);
    if (!runtime) return null;
    return runtime.webhookHandlers[platform] || null;
  }

  /**
   * Get the legacy global webhooks handler map for Hono route delegation.
   * Used by the deprecated global webhook route.
   */
  get webhooks(): Record<string, WebhookHandler> {
    if (!this.legacyChat) return {};
    return this.legacyChat.webhooks as Record<string, WebhookHandler>;
  }

  /** Get list of legacy global platform names */
  get platforms(): string[] {
    return Object.keys(this.webhooks);
  }

  /** Get per-agent platform status for the platform listing endpoint */
  listAgentPlatforms(): Array<{ agentId: string; agentName: string; platforms: string[] }> {
    const result: Array<{ agentId: string; agentName: string; platforms: string[] }> = [];
    for (const [agentId, runtime] of this.runtimes) {
      const agent = agentStore.getAgent(agentId);
      result.push({
        agentId,
        agentName: agent?.name || agentId,
        platforms: runtime.platforms,
      });
    }
    return result;
  }

  // ── Legacy global handlers (deprecated env-var based setup) ──

  /**
   * Register handlers on the legacy global Chat SDK instance.
   * These scan all agents to find a match (the old behavior).
   */
  private registerLegacyHandlers(): void {
    if (!this.legacyChat) return;

    this.legacyChat.onNewMention(async (thread: Thread<CompanionThreadState>, message: ChatMessage) => {
      await this.handleLegacyMention(thread, message);
    });

    this.legacyChat.onSubscribedMessage(async (thread: Thread<CompanionThreadState>, message: ChatMessage) => {
      await this.handleLegacySubscribedMessage(thread, message);
    });
  }

  /**
   * Legacy mention handler: find the right agent by scanning all agents,
   * start a session, relay responses. Used when agents don't have per-binding credentials.
   */
  private async handleLegacyMention(thread: Thread<CompanionThreadState>, message: ChatMessage): Promise<void> {
    const adapterName = this.getAdapterNameFromThread(thread);
    const agent = this.findAgentForPlatform(adapterName, message.text);
    if (!agent) {
      await thread.post("No agent is configured to handle this platform. Configure an agent with a chat trigger in The Companion.");
      return;
    }

    await this.startAgentSession(agent, adapterName, thread, message);
  }

  private async handleLegacySubscribedMessage(thread: Thread<CompanionThreadState>, message: ChatMessage): Promise<void> {
    const state = await thread.state;
    if (!state?.sessionId) {
      await this.handleLegacyMention(thread, message);
      return;
    }

    try {
      await thread.startTyping("Processing...");
      this.setupResponseRelay(state.sessionId, thread);
      this.wsBridge.injectUserMessage(state.sessionId, message.text);
    } catch (err) {
      console.error("[chat-bot] Error handling subscribed message:", err);
      await thread.post(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Agent-scoped handlers (per-agent credentials) ──

  /**
   * Handle a mention routed to a specific agent's Chat SDK instance.
   * The agent is already known — no need to scan all agents.
   */
  private async handleAgentMention(agentId: string, thread: Thread<CompanionThreadState>, message: ChatMessage): Promise<void> {
    const agent = agentStore.getAgent(agentId);
    if (!agent || !agent.enabled) {
      await thread.post("This agent is not available. Check The Companion for details.");
      return;
    }

    const adapterName = this.getAdapterNameFromThread(thread);

    // Check mention pattern if configured
    const binding = agent.triggers?.chat?.platforms?.find((p) => p.adapter === adapterName);
    if (binding?.mentionPattern && !this.testMentionPattern(binding.mentionPattern, message.text)) {
      // Message doesn't match the mention pattern — silently ignore
      return;
    }

    await this.startAgentSession(agent, adapterName, thread, message);
  }

  private async handleAgentSubscribedMessage(agentId: string, thread: Thread<CompanionThreadState>, message: ChatMessage): Promise<void> {
    const state = await thread.state;
    if (!state?.sessionId) {
      await this.handleAgentMention(agentId, thread, message);
      return;
    }

    try {
      await thread.startTyping("Processing...");
      this.setupResponseRelay(state.sessionId, thread);
      this.wsBridge.injectUserMessage(state.sessionId, message.text);
    } catch (err) {
      console.error("[chat-bot] Error handling subscribed message:", err);
      await thread.post(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Shared session lifecycle ──

  /**
   * Start an agent session for a chat mention and set up the response relay.
   */
  private async startAgentSession(
    agent: AgentConfig,
    adapterName: ChatAdapterName,
    thread: Thread<CompanionThreadState>,
    message: ChatMessage,
  ): Promise<void> {
    try {
      await thread.startTyping("Starting agent session...");

      const sessionInfo = await this.agentExecutor.executeAgent(agent.id, message.text, {
        force: true,
        triggerType: "chat",
      });

      if (!sessionInfo) {
        await thread.post("Failed to start agent session. Check The Companion for details.");
        return;
      }

      const sessionId = sessionInfo.sessionId;

      // Register listeners BEFORE any async platform calls — a fast agent may
      // complete before setState/subscribe finish, and without listeners
      // registered the first turn's response would be silently dropped.
      this.setupResponseRelay(sessionId, thread);

      await thread.setState({ sessionId, agentId: agent.id });

      // Subscribe to the thread for multi-turn if configured
      const binding = agent.triggers?.chat?.platforms?.find((p) => p.adapter === adapterName);
      if (binding?.autoSubscribe !== false) {
        await thread.subscribe();
      }
    } catch (err) {
      console.error("[chat-bot] Error handling mention:", err);
      await thread.post(`Error starting session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Set up bidirectional relay between a session and a chat thread.
   * Assistant messages from the CLI are posted back to the thread.
   */
  private setupResponseRelay(sessionId: string, thread: Thread<CompanionThreadState>): void {
    // Clean up any existing relay for this session to prevent listener leaks
    this.cleanupSession(sessionId);

    const unsubscribers: Array<() => void> = [];

    // Collect assistant text chunks and post them when a result arrives
    let pendingText = "";

    const unsubAssistant = this.wsBridge.onAssistantMessageForSession(sessionId, (msg) => {
      const text = extractTextFromAssistant(msg);
      if (text) {
        pendingText += (pendingText ? "\n" : "") + text;
      }
    });
    unsubscribers.push(unsubAssistant);

    const unsubResult = this.wsBridge.onResultForSession(sessionId, async () => {
      // Post accumulated text when the turn completes
      if (pendingText) {
        try {
          await thread.post(pendingText);
        } catch (err) {
          console.error("[chat-bot] Error posting response to platform:", err);
        }
        pendingText = "";
      }
    });
    unsubscribers.push(unsubResult);

    this.sessionUnsubscribers.set(sessionId, unsubscribers);
  }

  /**
   * Clean up listeners for a session.
   */
  cleanupSession(sessionId: string): void {
    const unsubs = this.sessionUnsubscribers.get(sessionId);
    if (unsubs) {
      unsubs.forEach((fn) => fn());
      this.sessionUnsubscribers.delete(sessionId);
    }
  }

  /**
   * Extract adapter name from a thread's ID (format: "adapter:channel:thread").
   */
  private getAdapterNameFromThread(thread: Thread<CompanionThreadState>): ChatAdapterName {
    const threadId = (thread as unknown as { id?: string }).id || "";
    const parts = threadId.split(":");
    return (parts[0] || "linear") as ChatAdapterName;
  }

  /**
   * Find an agent configured to handle a specific platform (legacy global handler).
   * Only matches agents that do NOT have per-binding credentials (those use agent-scoped handlers).
   */
  private findAgentForPlatform(adapterName: ChatAdapterName, messageText: string): AgentConfig | null {
    const agents = agentStore.listAgents();

    for (const agent of agents) {
      if (!agent.enabled) continue;
      if (!agent.triggers?.chat?.enabled) continue;

      const binding = agent.triggers.chat.platforms?.find((p) => p.adapter === adapterName);
      if (!binding) continue;

      // Skip agents that have their own credentials — they use agent-scoped handlers
      if (binding.credentials) continue;

      if (binding.mentionPattern) {
        if (!this.testMentionPattern(binding.mentionPattern, messageText)) continue;
      }

      return agent;
    }

    return null;
  }

  /**
   * Test a user-supplied regex pattern against text with ReDoS protection.
   */
  private testMentionPattern(pattern: string, text: string): boolean {
    try {
      const regex = new RegExp(pattern, "i");
      return regex.test(text.substring(0, 1000));
    } catch {
      return false;
    }
  }

  /** Graceful shutdown */
  async shutdown(): Promise<void> {
    // Snapshot keys first to avoid mutating the Map during iteration
    const sessionIds = [...this.sessionUnsubscribers.keys()];
    for (const sessionId of sessionIds) {
      this.cleanupSession(sessionId);
    }

    // Shut down all per-agent runtimes
    for (const [, runtime] of this.runtimes) {
      await runtime.chat.shutdown();
    }
    this.runtimes.clear();

    // Shut down legacy global instance
    if (this.legacyChat) {
      await this.legacyChat.shutdown();
      this.legacyChat = null;
    }
  }
}
