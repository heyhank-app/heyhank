// ─── Chat SDK Integration Layer ─────────────────────────────────────────────
// Bridges Vercel Chat SDK with Companion's agent execution system.
// External platforms (Linear, GitHub, Slack, etc.) send webhooks to the Chat SDK,
// which routes them to registered handlers. These handlers create/resume agent
// sessions and relay responses back to the platform.

import { Chat, ConsoleLogger } from "chat";
import type { Adapter, Thread, Message as ChatMessage } from "chat";
import { createLinearAdapter } from "@chat-adapter/linear";
import { createMemoryState } from "@chat-adapter/state-memory";
import type { AgentExecutor } from "./agent-executor.js";
import type { WsBridge } from "./ws-bridge.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import * as agentStore from "./agent-store.js";
import type { AgentConfig, ChatAdapterName } from "./agent-types.js";

/** State stored per-thread in the Chat SDK state adapter */
interface CompanionThreadState {
  /** Companion session ID linked to this thread */
  sessionId: string;
  /** Agent ID that handles this thread */
  agentId: string;
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

export class ChatBot {
  private chat: Chat<Record<string, Adapter>, CompanionThreadState> | null = null;
  private sessionUnsubscribers = new Map<string, Array<() => void>>();
  private agentExecutor: AgentExecutor;
  private wsBridge: WsBridge;

  constructor(agentExecutor: AgentExecutor, wsBridge: WsBridge) {
    this.agentExecutor = agentExecutor;
    this.wsBridge = wsBridge;
  }

  /**
   * Initialize Chat SDK if any platform env vars are configured.
   * Returns true if at least one adapter was initialized.
   */
  initialize(): boolean {
    const adapters: Record<string, Adapter> = {};

    // Linear adapter: requires LINEAR_API_KEY + LINEAR_WEBHOOK_SECRET
    if (process.env.LINEAR_API_KEY && process.env.LINEAR_WEBHOOK_SECRET) {
      adapters.linear = createLinearAdapter({
        apiKey: process.env.LINEAR_API_KEY,
        webhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
        userName: process.env.LINEAR_BOT_USERNAME || "companion",
      });
    }

    if (Object.keys(adapters).length === 0) {
      return false;
    }

    this.chat = new Chat<Record<string, Adapter>, CompanionThreadState>({
      userName: process.env.LINEAR_BOT_USERNAME || "companion",
      adapters,
      // NOTE: In-memory state — thread→session mappings are lost on server restart.
      // After a restart, follow-up messages create new sessions instead of continuing.
      // For production, consider implementing a disk-backed state adapter.
      state: createMemoryState(),
      logger: new ConsoleLogger("warn"),
    });

    this.registerHandlers();
    return true;
  }

  /** Get the webhooks handler map for Hono route delegation. */
  get webhooks(): Record<string, (req: Request, opts?: { waitUntil?: (task: Promise<unknown>) => void }) => Promise<Response>> {
    if (!this.chat) return {};
    return this.chat.webhooks as Record<string, (req: Request, opts?: { waitUntil?: (task: Promise<unknown>) => void }) => Promise<Response>>;
  }

  /** Get list of configured platform names */
  get platforms(): string[] {
    return Object.keys(this.webhooks);
  }

  /**
   * Register Chat SDK handlers that bridge to the agent executor.
   */
  private registerHandlers(): void {
    if (!this.chat) return;

    // Handle new @mentions in unsubscribed threads
    this.chat.onNewMention(async (thread: Thread<CompanionThreadState>, message: ChatMessage) => {
      await this.handleMention(thread, message);
    });

    // Handle follow-up messages in subscribed (multi-turn) threads
    this.chat.onSubscribedMessage(async (thread: Thread<CompanionThreadState>, message: ChatMessage) => {
      await this.handleSubscribedMessage(thread, message);
    });
  }

  /**
   * Handle a new @mention: find the right agent, start a session, relay responses.
   */
  private async handleMention(thread: Thread<CompanionThreadState>, message: ChatMessage): Promise<void> {
    // Determine which platform this came from (extract adapter name from thread ID)
    const adapterName = this.getAdapterNameFromThread(thread);

    // Find an agent configured to handle this platform
    const agent = this.findAgentForPlatform(adapterName, message.text);
    if (!agent) {
      await thread.post("No agent is configured to handle this platform. Configure an agent with a chat trigger in The Companion.");
      return;
    }

    try {
      await thread.startTyping("Starting agent session...");

      // Execute the agent with the message as input
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

      // Store thread→session mapping
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
   * Handle a follow-up message in a subscribed thread.
   */
  private async handleSubscribedMessage(thread: Thread<CompanionThreadState>, message: ChatMessage): Promise<void> {
    const state = await thread.state;
    if (!state?.sessionId) {
      // Thread is subscribed but no session linked — start a new one
      await this.handleMention(thread, message);
      return;
    }

    try {
      await thread.startTyping("Processing...");
      // Re-wire the response relay before injecting — the previous turn may
      // have exited (calling cleanupSession), which removes all listeners.
      // setupResponseRelay is idempotent (cleans up existing relay first).
      this.setupResponseRelay(state.sessionId, thread);
      // Inject the message into the existing session
      this.wsBridge.injectUserMessage(state.sessionId, message.text);
    } catch (err) {
      console.error("[chat-bot] Error handling subscribed message:", err);
      await thread.post(`Error: ${err instanceof Error ? err.message : String(err)}`);
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

    // Store unsubscribers for cleanup
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
    // Thread IDs follow the pattern: adapter:channelId:threadId
    // e.g., "linear:issue-uuid" or "linear:issue-uuid:c:comment-uuid"
    const threadId = (thread as unknown as { id?: string }).id || "";
    const parts = threadId.split(":");
    return (parts[0] || "linear") as ChatAdapterName;
  }

  /**
   * Find an agent configured to handle a specific platform.
   */
  private findAgentForPlatform(adapterName: ChatAdapterName, messageText: string): AgentConfig | null {
    const agents = agentStore.listAgents();

    for (const agent of agents) {
      if (!agent.enabled) continue;
      if (!agent.triggers?.chat?.enabled) continue;

      const binding = agent.triggers.chat.platforms?.find((p) => p.adapter === adapterName);
      if (!binding) continue;

      // If there's a mention pattern, check if the message matches
      if (binding.mentionPattern) {
        if (!this.testMentionPattern(binding.mentionPattern, messageText)) continue;
      }

      return agent;
    }

    return null;
  }

  /**
   * Test a user-supplied regex pattern against text with ReDoS protection.
   * Limits input length to avoid catastrophic backtracking.
   */
  private testMentionPattern(pattern: string, text: string): boolean {
    try {
      const regex = new RegExp(pattern, "i");
      // Limit text length to mitigate ReDoS from complex patterns
      return regex.test(text.substring(0, 1000));
    } catch {
      // Invalid regex — treat as no match
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
    if (this.chat) {
      await this.chat.shutdown();
      this.chat = null;
    }
  }
}
