// ─── IG Wizard Saved Posts ──────────────────────────────────────────────────
// The IG Wizard's persistent workbench. Every caption you compose (single or a
// 30-day-plan day) auto-saves here so reopening the wizard restores your work.
// You curate (delete / bulk-delete) down to the targeted posts, optionally
// generate a branded image, then promote the keepers "→ to Drafts" (the social
// publish queue). This store is intentionally SEPARATE from social drafts —
// wizard = workbench, drafts = ready-to-publish.
//
// Storage: ~/.heyhank/socialmedia/ig-wizard-posts.json (single JSON array).
// Single-user, low volume — same flat-file pattern as auto-dm-rules.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HEYHANK_HOME } from "./paths.js";

const DIR = join(HEYHANK_HOME, "socialmedia");
const POSTS_FILE = join(DIR, "ig-wizard-posts.json");

export type WizardPostSource = "single" | "plan";
export type WizardPostFormat = "post" | "carousel" | "reel";

export interface WizardPost {
  id: string;
  /** The topic/niche the caption was composed from. */
  topic: string;
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  /** The assembled, copy-paste-ready caption (hook + body + cta + #hashtags). */
  caption: string;
  /** Target platforms carried to the draft when promoted. */
  platforms: string[];
  /** Post format. "post" = single image, "carousel" = mediaUrls slides, "reel" = videoUrl. */
  format?: WizardPostFormat;
  /** Generated branded image (single-post format), if any. */
  imageUrl?: string | null;
  imageFilename?: string | null;
  /** Carousel slide image URLs (format === "carousel"). */
  mediaUrls?: string[];
  /** Reel video URL (format === "reel"). */
  videoUrl?: string | null;
  /** Reel poster/thumbnail image URL. */
  thumbnailUrl?: string | null;
  /** Hero scene used / to use for the image. */
  hero?: string;
  /** Image style id (cozy|business|pointing|bold|screen). AI-suggested, overridable. */
  style?: string;
  /** Where it came from — a standalone compose or a plan day. */
  source: WizardPostSource;
  /** For plan posts: the day number (1..30). */
  day?: number | null;
  /** If promoted to a social draft, the draft's id (so the UI can show it). */
  promotedDraftId?: string | null;
  createdAt: string;
  updatedAt: string;
}

function ensureDirs(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

function readAll(): WizardPost[] {
  ensureDirs();
  if (!existsSync(POSTS_FILE)) return [];
  try {
    const arr = JSON.parse(readFileSync(POSTS_FILE, "utf-8")) as WizardPost[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(posts: WizardPost[]): void {
  ensureDirs();
  writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/** Newest first. */
export function listPosts(): WizardPost[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getPost(id: string): WizardPost | null {
  return readAll().find((p) => p.id === id) ?? null;
}

export type CreateWizardPostInput = Pick<WizardPost, "topic" | "hook" | "body" | "cta" | "hashtags" | "caption" | "source"> &
  Partial<Pick<WizardPost, "platforms" | "imageUrl" | "imageFilename" | "hero" | "day" | "format" | "mediaUrls" | "videoUrl" | "thumbnailUrl" | "style">>;

export function createPost(input: CreateWizardPostInput): WizardPost {
  const now = new Date().toISOString();
  const post: WizardPost = {
    id: randomUUID(),
    topic: input.topic,
    hook: input.hook,
    body: input.body,
    cta: input.cta,
    hashtags: input.hashtags ?? [],
    caption: input.caption,
    platforms: input.platforms ?? ["instagram"],
    format: input.format ?? "post",
    imageUrl: input.imageUrl ?? null,
    imageFilename: input.imageFilename ?? null,
    mediaUrls: input.mediaUrls ?? [],
    videoUrl: input.videoUrl ?? null,
    thumbnailUrl: input.thumbnailUrl ?? null,
    hero: input.hero,
    style: input.style ?? "cozy",
    source: input.source,
    day: input.day ?? null,
    promotedDraftId: null,
    createdAt: now,
    updatedAt: now,
  };
  const posts = readAll();
  posts.push(post);
  writeAll(posts);
  return post;
}

export function updatePost(id: string, patch: Partial<Omit<WizardPost, "id" | "createdAt">>): WizardPost | null {
  const posts = readAll();
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  posts[idx] = { ...posts[idx], ...patch, updatedAt: new Date().toISOString() };
  writeAll(posts);
  return posts[idx];
}

export function removePost(id: string): boolean {
  const posts = readAll();
  const next = posts.filter((p) => p.id !== id);
  if (next.length === posts.length) return false;
  writeAll(next);
  return true;
}

/** Delete many at once. Returns the count actually removed. */
export function bulkRemove(ids: string[]): number {
  const idSet = new Set(ids);
  const posts = readAll();
  const next = posts.filter((p) => !idSet.has(p.id));
  const removed = posts.length - next.length;
  if (removed > 0) writeAll(next);
  return removed;
}

// ─── Test utility (only for vitest) ──────────────────────────────────────────

export function _resetForTest(): void {
  if (existsSync(POSTS_FILE)) writeAll([]);
}
