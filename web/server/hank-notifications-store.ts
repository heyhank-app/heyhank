// ─── Hank Notifications Store ───────────────────────────────────────────────
// Persistent queue of events that should be delivered to HankChat asynchronously
// (e.g. "call ended, please summarise"). Survives server restarts and HankChat
// being closed.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { TranscriptEntry } from "./telephony/call-types.js";

export interface CallEndedNotification {
  id: string;
  type: "call-ended";
  createdAt: number;
  consumed: boolean;
  callId: string;
  phone: string;
  contactName: string | null;
  direction: "inbound" | "outbound";
  durationSeconds: number;
  summary: string | null;
  transcript: TranscriptEntry[];
}

export type HankNotification = CallEndedNotification;

const DATA_DIR = join(homedir(), ".heyhank");
const FILE = join(DATA_DIR, "hank-notifications.json");
const MAX_KEEP = 100; // keep last N (consumed + unconsumed) to avoid unbounded growth

let cache: HankNotification[] | null = null;

function load(): HankNotification[] {
  if (cache) return cache;
  try {
    if (!existsSync(FILE)) return (cache = []);
    const raw = readFileSync(FILE, "utf-8");
    cache = JSON.parse(raw) as HankNotification[];
    if (!Array.isArray(cache)) cache = [];
    return cache;
  } catch (err) {
    console.error("[hank-notifications] Failed to load store:", err);
    return (cache = []);
  }
}

function persist(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const list = load();
    // Trim to most recent MAX_KEEP
    const trimmed = list.slice(-MAX_KEEP);
    writeFileSync(FILE, JSON.stringify(trimmed, null, 2), "utf-8");
    cache = trimmed;
  } catch (err) {
    console.error("[hank-notifications] Failed to persist store:", err);
  }
}

export function addNotification(
  n: Omit<HankNotification, "id" | "createdAt" | "consumed">,
): HankNotification {
  const list = load();
  const full: HankNotification = {
    id: randomUUID(),
    createdAt: Date.now(),
    consumed: false,
    ...n,
  };
  list.push(full);
  persist();
  return full;
}

export function listPending(): HankNotification[] {
  return load().filter((n) => !n.consumed);
}

export function markConsumed(id: string): boolean {
  const list = load();
  const n = list.find((x) => x.id === id);
  if (!n) return false;
  n.consumed = true;
  persist();
  return true;
}

export function getById(id: string): HankNotification | null {
  return load().find((n) => n.id === id) ?? null;
}
