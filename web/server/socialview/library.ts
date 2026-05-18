// ─── SocialView Library ──────────────────────────────────────────────────────
// File-based storage for reference posts. Layout:
//   ~/.heyhank/socialview/library/<platform>/<id>.json
//   ~/.heyhank/socialview/media/<id>-<i>.<ext>
// No database: a flat directory is plenty for a few thousand posts and makes
// backup/inspection trivial.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "../paths.js";
import type { LibraryPost, LibraryQuery, SocialPlatform } from "./types.js";
import { SOCIAL_PLATFORMS } from "./types.js";

const LIBRARY_ROOT = join(HEYHANK_HOME, "socialview", "library");
export const MEDIA_ROOT = join(HEYHANK_HOME, "socialview", "media");

function platformDir(platform: SocialPlatform): string {
  return join(LIBRARY_ROOT, platform);
}

function postPath(platform: SocialPlatform, id: string): string {
  return join(platformDir(platform), `${id}.json`);
}

export function ensureDirs(): void {
  mkdirSync(MEDIA_ROOT, { recursive: true });
  for (const p of SOCIAL_PLATFORMS) {
    mkdirSync(platformDir(p), { recursive: true });
  }
}

export function savePost(post: LibraryPost): void {
  ensureDirs();
  writeFileSync(postPath(post.platform, post.id), JSON.stringify(post, null, 2));
}

export function getPost(platform: SocialPlatform, id: string): LibraryPost | null {
  const path = postPath(platform, id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as LibraryPost;
  } catch {
    return null;
  }
}

export function deletePost(platform: SocialPlatform, id: string): boolean {
  const path = postPath(platform, id);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/** List posts across all platforms, newest first, with optional filters. */
export function listPosts(q: LibraryQuery = {}): LibraryPost[] {
  ensureDirs();
  const platforms = q.platform ? [q.platform] : SOCIAL_PLATFORMS;
  const out: LibraryPost[] = [];

  for (const p of platforms) {
    const dir = platformDir(p);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const post = JSON.parse(readFileSync(join(dir, file), "utf-8")) as LibraryPost;
        if (!matchesQuery(post, q)) continue;
        out.push(post);
      } catch {
        // skip malformed
      }
    }
  }

  const sortBy = q.sortBy ?? "extracted";
  out.sort((a, b) => compareForSort(a, b, sortBy));
  if (q.limit && out.length > q.limit) return out.slice(0, q.limit);
  return out;
}

function compareForSort(a: LibraryPost, b: LibraryPost, sortBy: NonNullable<LibraryQuery["sortBy"]>): number {
  if (sortBy === "posted") {
    // postedAt is ISO-8601 — string compare is correct ordering. Nulls
    // (postedAt missing) sink to the bottom so the surfaced "latest" feed
    // doesn't get polluted by undated posts.
    const ap = a.postedAt ?? "";
    const bp = b.postedAt ?? "";
    if (ap && bp) return bp > ap ? 1 : -1;
    if (ap) return -1;
    if (bp) return 1;
    return 0;
  }
  if (sortBy === "engagement") {
    // Likes is the most consistent signal across platforms; fall back to
    // engagementRate when likes are missing, then to extractedAt as a tiebreak.
    const al = a.engagement.likes ?? -1;
    const bl = b.engagement.likes ?? -1;
    if (al !== bl) return bl - al;
    const ar = a.engagementRate ?? -1;
    const br = b.engagementRate ?? -1;
    if (ar !== br) return br - ar;
    return b.extractedAt > a.extractedAt ? 1 : -1;
  }
  return b.extractedAt > a.extractedAt ? 1 : -1;
}

function matchesQuery(post: LibraryPost, q: LibraryQuery): boolean {
  if (q.source && post.source !== q.source) return false;
  if (q.goldOnly && !post.isGold) return false;
  if (typeof q.minEngagementRate === "number") {
    if ((post.engagementRate ?? 0) < q.minEngagementRate) return false;
  }
  if (typeof q.minLikes === "number") {
    if ((post.engagement.likes ?? 0) < q.minLikes) return false;
  }
  if (q.tags && q.tags.length > 0) {
    const tagset = new Set(post.tags);
    for (const t of q.tags) if (!tagset.has(t)) return false;
  }
  if (typeof q.postedWithinDays === "number" && q.postedWithinDays > 0) {
    if (!post.postedAt) return false;
    const ageMs = Date.now() - new Date(post.postedAt).getTime();
    if (ageMs > q.postedWithinDays * 24 * 60 * 60 * 1000) return false;
    // Negative age (clock skew, future-dated post) — keep, treat as fresh.
  }
  return true;
}

export function updatePost(
  platform: SocialPlatform,
  id: string,
  patch: Partial<Pick<LibraryPost, "tags" | "isGold" | "notes" | "source">>,
): LibraryPost | null {
  const existing = getPost(platform, id);
  if (!existing) return null;
  const updated: LibraryPost = { ...existing, ...patch };
  savePost(updated);
  return updated;
}

/** Top-N posts for agent few-shot. Prefers gold + high engagement on the platform. */
export function selectForFewShot(platform: SocialPlatform, limit: number = 5): LibraryPost[] {
  const candidates = listPosts({ platform, goldOnly: true });
  // Sort by engagementRate desc (nulls last)
  candidates.sort((a, b) => {
    const ar = a.engagementRate ?? -1;
    const br = b.engagementRate ?? -1;
    return br - ar;
  });
  return candidates.slice(0, limit);
}
