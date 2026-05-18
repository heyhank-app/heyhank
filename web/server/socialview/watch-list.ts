// ─── SocialView Watch-List ───────────────────────────────────────────────────
// CRUD for the creator watch-list consumed by the auto-crawler.
//
// Storage: single JSON file at ~/.heyhank/socialview/watch-list.json. The
// dataset is small (typically <100 entries) so a flat array on disk is plenty
// and avoids the synchronization overhead of one-file-per-entry. All writes
// are atomic via a temp-file-then-rename to survive process kill mid-write.

import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { HEYHANK_HOME } from "../paths.js";
import type { SocialPlatform, WatchListEntry } from "./types.js";

// Mutable so tests can redirect to a temp dir via _resetForTest().
// Same approach as settings-manager.ts._resetForTest.
let WATCH_LIST_PATH = join(HEYHANK_HOME, "socialview", "watch-list.json");

function ensureDir(): void {
  mkdirSync(dirname(WATCH_LIST_PATH), { recursive: true });
}

function readAll(): WatchListEntry[] {
  if (!existsSync(WATCH_LIST_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(WATCH_LIST_PATH, "utf-8"));
    return Array.isArray(parsed) ? (parsed as WatchListEntry[]) : [];
  } catch {
    // Corrupt or empty file: treat as empty so a save still works.
    return [];
  }
}

function writeAll(entries: WatchListEntry[]): void {
  ensureDir();
  const tmp = `${WATCH_LIST_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2));
  renameSync(tmp, WATCH_LIST_PATH);
}

export interface WatchListListQuery {
  platform?: SocialPlatform;
  enabledOnly?: boolean;
}

export function list(q: WatchListListQuery = {}): WatchListEntry[] {
  let entries = readAll();
  if (q.platform) entries = entries.filter((e) => e.platform === q.platform);
  if (q.enabledOnly) entries = entries.filter((e) => e.enabled);
  // Sort by createdAt desc so newest entries show first in the UI.
  entries.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  return entries;
}

export function get(id: string): WatchListEntry | null {
  return readAll().find((e) => e.id === id) ?? null;
}

export interface CreateInput {
  platform: SocialPlatform;
  handle: string;
  displayName?: string;
  notes?: string;
  enabled?: boolean;
}

/**
 * Add a new watch-list entry. Rejects duplicates by (platform, handle) — case-
 * insensitive on the handle — so the user can't accidentally watch the same
 * creator twice on the same platform. Returns either the new entry or an error
 * the route can surface as 400/409.
 */
export function create(input: CreateInput): { ok: true; entry: WatchListEntry } | { ok: false; error: string; code: number } {
  const handle = input.handle.replace(/^@/, "").trim();
  if (!handle) return { ok: false, error: "handle is required", code: 400 };
  if (!/^[a-zA-Z0-9._-]+$/.test(handle)) {
    return { ok: false, error: "handle contains invalid characters", code: 400 };
  }

  const entries = readAll();
  const dup = entries.find((e) => e.platform === input.platform && e.handle.toLowerCase() === handle.toLowerCase());
  if (dup) return { ok: false, error: `already watching ${handle} on ${input.platform}`, code: 409 };

  const entry: WatchListEntry = {
    id: randomUUID(),
    platform: input.platform,
    handle,
    displayName: input.displayName?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    enabled: input.enabled ?? true,
    createdAt: new Date().toISOString(),
    lastCrawledAt: null,
    lastCrawlStatus: "never",
  };
  entries.push(entry);
  writeAll(entries);
  return { ok: true, entry };
}

export type UpdatePatch = Partial<Pick<WatchListEntry,
  | "displayName"
  | "notes"
  | "enabled"
  | "lastCrawledAt"
  | "lastCrawlStatus"
  | "lastCrawlMessage"
  | "lastCrawlPostsExtracted"
>>;

export function update(id: string, patch: UpdatePatch): WatchListEntry | null {
  const entries = readAll();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const updated: WatchListEntry = { ...entries[idx], ...patch };
  entries[idx] = updated;
  writeAll(entries);
  return updated;
}

export function remove(id: string): boolean {
  const entries = readAll();
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) return false;
  writeAll(next);
  return true;
}

/** Internal: expose the storage path so tests can inspect it. */
export function _storagePath(): string {
  return WATCH_LIST_PATH;
}

/** Test-only: redirect storage to an alternate path. */
export function _resetForTest(path: string): void {
  WATCH_LIST_PATH = path;
}
