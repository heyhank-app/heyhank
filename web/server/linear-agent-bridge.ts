// ─── Linear Agent Session Bridge ──────────────────────────────────────────────
// Bridges Linear Agent Interaction SDK sessions with Companion CLI sessions.
// When Linear sends an AgentSessionEvent webhook, this module:
// 1. Acknowledges immediately (post a "thought" activity within 10s)
// 2. Finds the right Companion agent to handle it
// 3. Launches a CLI session via AgentExecutor
// 4. Relays CLI output back to Linear as agent activities

import type { AgentExecutor } from "./agent-executor.js";
import type { WsBridge } from "./ws-bridge.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import * as agentStore from "./agent-store.js";
import * as linearAgent from "./linear-agent.js";
import type { AgentSessionEventPayload } from "./linear-agent.js";
import { getSettings } from "./settings-manager.js";

/** Safely extract the content array from an assistant-type message. */
function getAssistantContent(msg: BrowserIncomingMessage): unknown[] | null {
  if (msg.type !== "assistant") return null;
  // Assistant messages carry content blocks at msg.message.content
  const raw = msg as Record<string, unknown>;
  const message = raw.message;
  if (!message || typeof message !== "object") return null;
  const content = (message as Record<string, unknown>).content;
  return Array.isArray(content) ? content : null;
}

/** Extract text from assistant message content blocks */
function extractTextFromAssistant(msg: BrowserIncomingMessage): string {
  const content = getAssistantContent(msg);
  if (!content) return "";
  return content
    .filter((b): b is { type: string; text: string } =>
      typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text" && typeof (b as Record<string, unknown>).text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** Extract all tool use blocks from assistant message content */
function extractToolUses(msg: BrowserIncomingMessage): Array<{ name: string; input: string }> {
  const content = getAssistantContent(msg);
  if (!content) return [];
  return content
    .filter((b): b is { type: string; name: string; input?: Record<string, unknown> } =>
      typeof b === "object" && b !== null
      && (b as Record<string, unknown>).type === "tool_use"
      && typeof (b as Record<string, unknown>).name === "string")
    .map((toolBlock) => ({
      name: toolBlock.name,
      input: toolBlock.input ? JSON.stringify(toolBlock.input).slice(0, 200) : "",
    }));
}

export class LinearAgentBridge {
  private agentExecutor: AgentExecutor;
  private wsBridge: WsBridge;

  /** Maps Linear agent session IDs to Companion session IDs */
  private sessionMap = new Map<string, string>();
  /** Maps Companion session IDs back to Linear agent session IDs */
  private reverseMap = new Map<string, string>();
  /** Track active session unsubscribers for cleanup */
  private sessionCleanups = new Map<string, Array<() => void>>();

  constructor(agentExecutor: AgentExecutor, wsBridge: WsBridge) {
    this.agentExecutor = agentExecutor;
    this.wsBridge = wsBridge;
  }

  /** Handle an incoming AgentSessionEvent from Linear. */
  async handleEvent(payload: AgentSessionEventPayload): Promise<void> {
    if (payload.action === "created") {
      await this.handleCreated(payload);
    } else if (payload.action === "prompted") {
      await this.handlePrompted(payload);
    }
  }

  /** Handle a new agent session (user mentioned or assigned the agent). */
  private async handleCreated(payload: AgentSessionEventPayload): Promise<void> {
    const linearSessionId = payload.data.id;
    const promptContext = payload.data.promptContext || "";

    console.log(`[linear-agent-bridge] New agent session: ${linearSessionId}`);

    // 1. Immediately acknowledge with a thought (must be within 10s)
    linearAgent.postActivity(linearSessionId, {
      type: "thought",
      body: "Starting Companion session...",
      ephemeral: true,
    }).catch((err) => console.error("[linear-agent-bridge] Failed to post initial thought:", err));

    // 2. Find the right Companion agent
    const agent = this.findLinearAgent();
    if (!agent) {
      await linearAgent.postActivity(linearSessionId, {
        type: "error",
        body: "No Companion agent is configured to handle Linear mentions. Enable the Linear trigger on an agent in The Companion.",
      });
      return;
    }

    // 3. Launch the CLI session
    try {
      const sessionInfo = await this.agentExecutor.executeAgent(agent.id, promptContext, {
        force: true,
        triggerType: "linear",
      });

      if (!sessionInfo) {
        // Check if the agent is already running (overlap prevention)
        const agentData = agentStore.getAgent(agent.id);
        const isOverlap = agentData?.lastSessionId && this.wsBridge.getSession(agentData.lastSessionId);
        await linearAgent.postActivity(linearSessionId, {
          type: "error",
          body: isOverlap
            ? `Agent "${agent.name}" is currently busy with another session. Please wait for it to complete.`
            : "Failed to start Companion session. Check The Companion for details.",
        });
        return;
      }

      const companionSessionId = sessionInfo.sessionId;

      // 4. Map sessions
      this.sessionMap.set(linearSessionId, companionSessionId);
      this.reverseMap.set(companionSessionId, linearSessionId);

      // 5. Set external URL linking back to Companion
      const settings = getSettings();
      const baseUrl = settings.publicUrl || "http://localhost:3456";
      linearAgent.updateSessionUrls(linearSessionId, [
        { label: "Companion Session", url: `${baseUrl}/#/session/${companionSessionId}` },
      ]).catch((err) => console.error("[linear-agent-bridge] Failed to set external URLs:", err));

      // 6. Set up response relay
      this.setupRelay(linearSessionId, companionSessionId);

      await linearAgent.postActivity(linearSessionId, {
        type: "thought",
        body: `Agent "${agent.name}" session started. Working on it...`,
      });
    } catch (err) {
      console.error("[linear-agent-bridge] Failed to start session:", err);
      await linearAgent.postActivity(linearSessionId, {
        type: "error",
        body: `Failed to start session: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /** Handle a follow-up prompt in an existing agent session. */
  private async handlePrompted(payload: AgentSessionEventPayload): Promise<void> {
    const linearSessionId = payload.data.id;
    const message = (payload.agentActivity?.body || "").trim();

    // Skip empty follow-ups — no point injecting a blank message
    if (!message) {
      console.log(`[linear-agent-bridge] Ignoring empty follow-up for ${linearSessionId}`);
      return;
    }

    const companionSessionId = this.sessionMap.get(linearSessionId);
    if (!companionSessionId) {
      // Session not found — might have expired. Create a new one with the follow-up message.
      console.log(`[linear-agent-bridge] No session mapping for ${linearSessionId}, creating new`);
      await this.handleCreated({
        ...payload,
        action: "created",
        data: { ...payload.data, promptContext: message },
      });
      return;
    }

    console.log(`[linear-agent-bridge] Follow-up for session ${linearSessionId} → ${companionSessionId}`);

    // Check if the Companion session is still alive before injecting
    const session = this.wsBridge.getSession(companionSessionId);
    if (!session) {
      console.log(`[linear-agent-bridge] Session ${companionSessionId} is dead, creating new`);
      // Clean up stale mapping
      this.sessionMap.delete(linearSessionId);
      this.reverseMap.delete(companionSessionId);
      this.cleanupRelay(companionSessionId);
      // Start a new session with the follow-up message as prompt context
      await this.handleCreated({
        ...payload,
        action: "created",
        data: { ...payload.data, promptContext: message },
      });
      return;
    }

    // Post acknowledgement
    linearAgent.postActivity(linearSessionId, {
      type: "thought",
      body: "Processing follow-up...",
      ephemeral: true,
    }).catch((err) => console.error("[linear-agent-bridge] Failed to post thought:", err));

    // Re-establish relay for the new turn (resets pendingText accumulator).
    // setupRelay calls cleanupRelay internally first, so old listeners are removed.
    this.setupRelay(linearSessionId, companionSessionId);

    // Inject user message into the running Companion session
    this.wsBridge.injectUserMessage(companionSessionId, message);
  }

  /** Set up bidirectional relay between a Companion session and a Linear agent session. */
  private setupRelay(linearSessionId: string, companionSessionId: string): void {
    // Clean up any existing relay
    this.cleanupRelay(companionSessionId);

    const cleanups: Array<() => void> = [];
    let pendingText = "";

    // Relay assistant messages → Linear activities
    const unsubAssistant = this.wsBridge.onAssistantMessageForSession(companionSessionId, (msg) => {
      const text = extractTextFromAssistant(msg);
      if (text) {
        pendingText += (pendingText ? "\n" : "") + text;
      }

      // Relay all tool use blocks as action activities (supports parallel tool calls)
      for (const tool of extractToolUses(msg)) {
        linearAgent.postActivity(linearSessionId, {
          type: "action",
          action: tool.name,
          parameter: tool.input || undefined,
          ephemeral: true,
        }).catch((err) => console.error("[linear-agent-bridge] Failed to post action:", err));
      }
    });
    cleanups.push(unsubAssistant);

    // Relay turn completion → post accumulated text as a response activity.
    // Do NOT clean up session mappings or relay — the Linear agent session
    // is long-lived and supports multi-turn follow-ups via "prompted" events.
    const unsubResult = this.wsBridge.onResultForSession(companionSessionId, async () => {
      if (pendingText) {
        try {
          await linearAgent.postActivity(linearSessionId, {
            type: "response",
            body: pendingText,
          });
        } catch (err) {
          console.error("[linear-agent-bridge] Failed to post response:", err);
        }
        pendingText = "";
      }
    });
    cleanups.push(unsubResult);

    this.sessionCleanups.set(companionSessionId, cleanups);
  }

  /** Clean up listeners for a session. */
  private cleanupRelay(companionSessionId: string): void {
    const cleanups = this.sessionCleanups.get(companionSessionId);
    if (cleanups) {
      cleanups.forEach((fn) => fn());
      this.sessionCleanups.delete(companionSessionId);
    }
  }

  /** Find the first enabled agent with a Linear trigger. */
  private findLinearAgent() {
    const agents = agentStore.listAgents();
    return agents.find((a) => a.enabled && a.triggers?.linear?.enabled) || null;
  }

  /** Clean up all session mappings and listeners. */
  shutdown(): void {
    for (const [companionSessionId] of this.sessionCleanups) {
      this.cleanupRelay(companionSessionId);
    }
    this.sessionMap.clear();
    this.reverseMap.clear();
  }
}
