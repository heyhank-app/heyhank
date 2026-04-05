// ─── Inter-Agent Message Bus ─────────────────────────────────────────────────
// Ported from AgentManager/src/messages.ts — adapted for HeyHank/Bun

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MessageType =
  | "task"
  | "result"
  | "question"
  | "info"
  | "status"
  | "interrupt";

export const VALID_MESSAGE_TYPES: MessageType[] = [
  "task",
  "result",
  "question",
  "info",
  "status",
  "interrupt",
];

export interface AgentMessage {
  id: string;
  from: string;
  fromName?: string;
  to?: string;
  channel?: string;
  type: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  readBy: string[];
}

export interface MessageQuery {
  to?: string;
  from?: string;
  channel?: string;
  type?: MessageType;
  unreadBy?: string;
  since?: string;
  limit?: number;
}

type MessageListener = (msg: AgentMessage) => void;

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_MESSAGES = 500;
const MESSAGES_FILE = join(HEYHANK_HOME, "messages.jsonl");
const DEBOUNCE_MS = 500;

// ─── MessageBus ──────────────────────────────────────────────────────────────

export class MessageBus {
  private messages: AgentMessage[] = [];
  private listeners = new Set<MessageListener>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor() {
    this.restore();
  }

  /** Post a new message to the bus. */
  post(opts: {
    from: string;
    fromName?: string;
    to?: string;
    channel?: string;
    type: MessageType;
    content: string;
    metadata?: Record<string, unknown>;
  }): AgentMessage {
    const msg: AgentMessage = {
      id: randomUUID(),
      from: opts.from,
      fromName: opts.fromName,
      to: opts.to,
      channel: opts.channel,
      type: opts.type,
      content: opts.content,
      metadata: opts.metadata,
      createdAt: new Date().toISOString(),
      readBy: [],
    };

    this.messages.push(msg);
    this.trim();
    this.schedulePersist();

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch (err) {
        console.error("[message-bus] Listener error:", err);
      }
    }

    return msg;
  }

  /** Query messages with optional filters. */
  query(opts?: MessageQuery): AgentMessage[] {
    let result = [...this.messages];
    if (opts?.to) {
      result = result.filter(
        (m) => m.to === opts.to || m.to === undefined,
      );
    }
    if (opts?.from) {
      result = result.filter((m) => m.from === opts.from);
    }
    if (opts?.channel) {
      result = result.filter((m) => m.channel === opts.channel);
    }
    if (opts?.type) {
      result = result.filter((m) => m.type === opts.type);
    }
    if (opts?.unreadBy) {
      const agentId = opts.unreadBy;
      result = result.filter((m) => !m.readBy.includes(agentId));
    }
    if (opts?.since) {
      result = result.filter((m) => m.createdAt > opts.since!);
    }
    const limit = opts?.limit ?? 100;
    return result.slice(-limit);
  }

  /** Mark a message as read by an agent. */
  markRead(messageId: string, agentId: string): void {
    const msg = this.messages.find((m) => m.id === messageId);
    if (msg && !msg.readBy.includes(agentId)) {
      msg.readBy.push(agentId);
      this.schedulePersist();
    }
  }

  /** Mark all messages targeted at an agent as read. */
  markAllRead(agentId: string): void {
    let changed = false;
    for (const msg of this.messages) {
      if (
        (msg.to === agentId || msg.to === undefined) &&
        !msg.readBy.includes(agentId)
      ) {
        msg.readBy.push(agentId);
        changed = true;
      }
    }
    if (changed) this.schedulePersist();
  }

  /** Get count of unread messages for an agent. */
  unreadCount(agentId: string): number {
    return this.messages.filter(
      (m) =>
        (m.to === agentId || m.to === undefined) &&
        !m.readBy.includes(agentId),
    ).length;
  }

  /** Delete a single message. */
  deleteMessage(id: string): boolean {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.messages.splice(idx, 1);
    this.schedulePersist();
    return true;
  }

  /** Clear all messages. */
  clearAll(): void {
    this.messages = [];
    this.persistNow();
  }

  /** Remove all messages to/from a specific agent. */
  cleanupForAgent(agentId: string): void {
    const before = this.messages.length;
    this.messages = this.messages.filter(
      (m) => m.from !== agentId && m.to !== agentId,
    );
    if (this.messages.length !== before) {
      this.schedulePersist();
    }
  }

  /** Subscribe to new messages. Returns unsubscribe function. */
  subscribe(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Get all messages (for debugging/admin). */
  getAll(): AgentMessage[] {
    return [...this.messages];
  }

  // ─── Persistence ─────────────────────────────────────────────────────

  private trim(): void {
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (this.dirty) this.persistNow();
    }, DEBOUNCE_MS);
  }

  private persistNow(): void {
    this.dirty = false;
    try {
      mkdirSync(dirname(MESSAGES_FILE), { recursive: true });
      const data = this.messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
      const tmpFile = MESSAGES_FILE + ".tmp";
      writeFileSync(tmpFile, data, "utf-8");
      renameSync(tmpFile, MESSAGES_FILE);
    } catch (err) {
      console.error("[message-bus] Failed to persist:", err);
    }
  }

  private restore(): void {
    try {
      if (!existsSync(MESSAGES_FILE)) return;
      const raw = readFileSync(MESSAGES_FILE, "utf-8");
      const lines = raw.split("\n").filter((l) => l.trim());
      const restored: AgentMessage[] = [];
      for (const line of lines) {
        try {
          restored.push(JSON.parse(line));
        } catch {
          // Skip corrupt lines
        }
      }
      // Keep only last MAX_MESSAGES
      this.messages = restored.slice(-MAX_MESSAGES);
      console.log(
        `[message-bus] Restored ${this.messages.length} messages from disk`,
      );
    } catch (err) {
      console.error("[message-bus] Failed to restore:", err);
    }
  }
}

/** Singleton instance */
export const messageBus = new MessageBus();
