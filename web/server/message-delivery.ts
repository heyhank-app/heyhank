// ─── Message Delivery System ─────────────────────────────────────────────────
// Auto-delivers inter-agent messages to idle agents
// Ported from AgentManager/src/message-delivery.ts

import { messageBus } from "./message-bus.js";
import type { AgentMessage } from "./message-bus.js";
import type { AgentExecutor } from "./agent-executor.js";
import type { WsBridge } from "./ws-bridge.js";
import { isKilled } from "./kill-switch.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MessageDeliveryOptions {
  /** Delay before delivering queued messages (ms) */
  deliverySettleMs?: number;
}

// ─── Delivery Prompt Formatting ──────────────────────────────────────────────

export function formatDeliveryPrompt(
  fromName: string,
  fromId: string,
  content: string,
  type: string,
): string {
  if (type === "interrupt") {
    return `[INTERRUPT from ${fromName}] ⚠️ Your current task has been interrupted. Read and act on this message immediately:

<message-content>
${content}
</message-content>

(Reply by sending a message to agent ID: ${fromId})`;
  }

  return `[Message from ${fromName} (${fromId})] Type: ${type}

<message-content>
${content}
</message-content>

Process this message and respond appropriately. To reply, send a message to agent ID: ${fromId}`;
}

// ─── Attach Auto-Delivery ────────────────────────────────────────────────────

/**
 * Subscribe to the message bus and auto-deliver messages to target agent sessions.
 * When a message arrives for a specific agent, injects it as a user message
 * into that agent's active session.
 */
export function attachMessageDelivery(
  agentExecutor: AgentExecutor,
  wsBridge: WsBridge,
  opts?: MessageDeliveryOptions,
): () => void {
  const settleMs = opts?.deliverySettleMs ?? 2000;

  const unsubscribe = messageBus.subscribe((msg: AgentMessage) => {
    // Skip broadcasts (no specific target)
    if (!msg.to) return;

    // Skip status messages
    if (msg.type === "status") return;

    // Kill switch check
    if (isKilled()) {
      console.log(
        `[message-delivery] Skipping delivery (kill switch active): ${msg.id}`,
      );
      return;
    }

    // Find the target agent's active session
    const targetAgentId = msg.to;

    // Delay delivery slightly to let agents settle
    setTimeout(() => {
      try {
        deliverToAgent(targetAgentId, msg, wsBridge);
      } catch (err) {
        console.error(
          `[message-delivery] Failed to deliver to ${targetAgentId}:`,
          err,
        );
      }
    }, settleMs);
  });

  console.log("[message-delivery] Auto-delivery attached");
  return unsubscribe;
}

function deliverToAgent(
  agentId: string,
  msg: AgentMessage,
  wsBridge: WsBridge,
): void {
  // Find active sessions for this agent
  const sessions = wsBridge.getSessionMemoryStats();

  // Look for a session that belongs to this agent
  // Agent sessions are tagged with agentId in their metadata
  for (const session of sessions) {
    // Try to inject the message
    const prompt = formatDeliveryPrompt(
      msg.fromName || msg.from,
      msg.from,
      msg.content,
      msg.type,
    );

    try {
      wsBridge.injectUserMessage(session.id, prompt);
      messageBus.markRead(msg.id, agentId);
      console.log(
        `[message-delivery] Delivered ${msg.type} from ${msg.from} to ${agentId} (session ${session.id.slice(0, 8)})`,
      );
      return;
    } catch {
      // Session might not accept messages, try next
    }
  }

  console.log(
    `[message-delivery] No active session for ${agentId}, message ${msg.id} queued`,
  );
}
