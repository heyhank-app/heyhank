// ─── IG Wizard Inspiration (manual swipe file) ──────────────────────────────
// A manually-curated library of posts from creators you admire. Instead of
// crawling Instagram (which Meta blocks from datacenter IPs — see the
// SocialView cookie-risk notes), you paste in the posts YOU like: caption text,
// the format (post / carousel / reel / story), optional media (uploaded files
// or external URLs), the source handle, and a note on why it works. Each item
// then gets a one-click "adapt for me" that rewrites the underlying theme in
// your own voice as a wizard draft.
//
// This is intentionally curated-by-hand: the signal is cleaner than bulk
// crawling because every entry is a post you genuinely want to learn from.
//
// Storage: ~/.heyhank/socialmedia/ig-inspiration.json (single JSON array).
// Single-user, low volume — same flat-file pattern as ig-wizard-posts.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HEYHANK_HOME } from "./paths.js";

const DIR = join(HEYHANK_HOME, "socialmedia");
const ITEMS_FILE = join(DIR, "ig-inspiration.json");

/** The post formats a creator can publish — what the import form offers. */
export type InspirationFormat = "post" | "carousel" | "reel" | "story";

export const INSPIRATION_FORMATS: InspirationFormat[] = ["post", "carousel", "reel", "story"];

export interface InspirationItem {
  id: string;
  /** Creator handle without a leading "@" (e.g. "vaibhavsisinty"). */
  handle: string;
  /** Which kind of post this is — drives the format of the adapted draft. */
  format: InspirationFormat;
  /** The pasted post caption / on-screen text — the actual content to learn from. */
  caption: string;
  /** Optional short theme to steer the adaptation (e.g. "self-hosting AI cheap"). */
  topic?: string;
  /** Media references: uploaded files (/api/media/file/<name>) or external URLs. */
  mediaUrls: string[];
  /** Optional link back to the original post. */
  sourceUrl?: string;
  /** Free-text note — why you saved it / what makes it work. */
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Coerce arbitrary input to a valid format, defaulting to "post". */
export function normalizeInspirationFormat(raw: unknown): InspirationFormat {
  return INSPIRATION_FORMATS.includes(raw as InspirationFormat) ? (raw as InspirationFormat) : "post";
}

/** Strip a leading "@" and surrounding whitespace from a handle. */
export function normalizeHandle(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().replace(/^@+/, "").trim() : "";
}

function ensureDirs(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

function readAll(): InspirationItem[] {
  ensureDirs();
  if (!existsSync(ITEMS_FILE)) return [];
  try {
    const arr = JSON.parse(readFileSync(ITEMS_FILE, "utf-8")) as InspirationItem[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(items: InspirationItem[]): void {
  ensureDirs();
  writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/** Newest first. */
export function listItems(): InspirationItem[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getItem(id: string): InspirationItem | null {
  return readAll().find((i) => i.id === id) ?? null;
}

export type CreateInspirationInput = {
  handle: string;
  format?: unknown;
  caption: string;
  topic?: string;
  mediaUrls?: unknown;
  sourceUrl?: string;
  notes?: string;
};

/** Keep only non-empty string media references, capped to a sane count. */
function cleanMediaUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const u of raw) {
    if (typeof u === "string" && u.trim()) out.push(u.trim());
    if (out.length >= 20) break;
  }
  return out;
}

export function createItem(input: CreateInspirationInput): InspirationItem {
  const now = new Date().toISOString();
  const item: InspirationItem = {
    id: randomUUID(),
    handle: normalizeHandle(input.handle),
    format: normalizeInspirationFormat(input.format),
    caption: typeof input.caption === "string" ? input.caption.trim() : "",
    topic: input.topic?.trim() || undefined,
    mediaUrls: cleanMediaUrls(input.mediaUrls),
    sourceUrl: input.sourceUrl?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  const items = readAll();
  items.push(item);
  writeAll(items);
  return item;
}

export function updateItem(
  id: string,
  patch: Partial<Omit<InspirationItem, "id" | "createdAt">>,
): InspirationItem | null {
  const items = readAll();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
  writeAll(items);
  return items[idx];
}

export function removeItem(id: string): boolean {
  const items = readAll();
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) return false;
  writeAll(next);
  return true;
}

// ─── Test utility (only for vitest) ──────────────────────────────────────────

export function _resetForTest(): void {
  if (existsSync(ITEMS_FILE)) writeAll([]);
}
