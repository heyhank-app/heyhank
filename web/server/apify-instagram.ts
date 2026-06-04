// ─── Apify Instagram scraper ────────────────────────────────────────────────
// The "do it like the pros" path for pulling a creator's recent Instagram posts
// WITHOUT touching our own account: Apify runs the scrape through rotating
// residential proxies + anonymous public IG endpoints, so there's no login, no
// sessionid, and therefore none of the datacenter-IP account-checkpoint risk
// that killed our own headful-browser crawler (see SocialView cookie-risk).
//
// We call Apify's official "apify/instagram-scraper" actor synchronously and
// map each post into our Inspiration shape. The Apify token lives in HeyHank
// settings (~/.heyhank/settings.json) — NEVER hardcoded — read here at runtime.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";
import { getSettings } from "./settings-manager.js";

const MEDIA_DIR = join(HEYHANK_HOME, "media");
// Apify actor path uses the "username~actor-name" form.
const ACTOR = "apify~instagram-scraper";
const RUN_SYNC_URL = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Resolve the Apify token from settings (preferred) or the APIFY_TOKEN env. */
export function apifyToken(): string {
  return getSettings().apifyApiKey?.trim() || process.env.APIFY_TOKEN || "";
}

export function hasApifyToken(): boolean {
  return !!apifyToken();
}

export type ScrapedFormat = "post" | "carousel" | "reel";

export interface ScrapedPost {
  caption: string;
  /** Mapped from Apify's "type" (Image/Sidecar/Video). */
  format: ScrapedFormat;
  /** Permalink to the original post. */
  url: string;
  /** Main image / video poster (Apify CDN URL — expires, so we download it). */
  imageUrl: string | null;
  videoUrl: string | null;
  ownerUsername: string;
  timestamp: string | null;
  likes: number;
  comments: number;
}

/** Map Apify's post "type" to our Inspiration format. */
export function mapApifyType(t: unknown): ScrapedFormat {
  if (t === "Video") return "reel";
  if (t === "Sidecar") return "carousel";
  return "post";
}

/** Normalize one raw Apify dataset item into a ScrapedPost (or null to drop). */
export function normalizeApifyItem(raw: unknown, fallbackHandle: string): ScrapedPost | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // Apify emits an error item (e.g. "Page not found") instead of post data.
  if (o.error) return null;
  const caption = typeof o.caption === "string" ? o.caption.trim() : "";
  if (!caption) return null; // no caption = no theme to learn from
  return {
    caption,
    format: mapApifyType(o.type),
    url: typeof o.url === "string" ? o.url : "",
    imageUrl: typeof o.displayUrl === "string" ? o.displayUrl : null,
    videoUrl: typeof o.videoUrl === "string" ? o.videoUrl : null,
    ownerUsername: typeof o.ownerUsername === "string" ? o.ownerUsername : fallbackHandle,
    timestamp: typeof o.timestamp === "string" ? o.timestamp : null,
    likes: typeof o.likesCount === "number" ? o.likesCount : 0,
    comments: typeof o.commentsCount === "number" ? o.commentsCount : 0,
  };
}

/**
 * Scrape a creator's recent posts via the Apify Instagram Scraper actor.
 * Runs synchronously (run-sync-get-dataset-items) and returns the normalized
 * posts. Throws a clean error on missing token / API failure.
 */
export async function scrapeInstagramPosts(
  input: { handle: string; limit?: number },
  deps?: { fetch?: FetchLike },
): Promise<ScrapedPost[]> {
  const token = apifyToken();
  if (!token) throw new Error("Apify API token not configured — add it in Settings.");
  const handle = input.handle.trim().replace(/^@+/, "");
  if (!handle) throw new Error("handle is required");
  const limit = Math.max(1, Math.min(50, Math.round(input.limit ?? 12)));
  const doFetch = deps?.fetch ?? (globalThis.fetch as FetchLike);

  const res = await doFetch(`${RUN_SYNC_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: [`https://www.instagram.com/${handle}/`],
      resultsType: "posts",
      resultsLimit: limit,
      addParentData: false,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      msg = j?.error?.message || msg;
    } catch {
      /* keep HTTP status */
    }
    throw new Error(`Apify scrape failed: ${msg}`);
  }

  let items: unknown;
  try {
    items = JSON.parse(text);
  } catch {
    throw new Error("Apify returned a non-JSON response");
  }
  if (!Array.isArray(items)) return [];
  return items
    .map((raw) => normalizeApifyItem(raw, handle))
    .filter((p): p is ScrapedPost => p !== null);
}

/**
 * Download a remote media URL to ~/.heyhank/media so the thumbnail survives
 * (Apify/IG CDN URLs are short-lived signed links). Returns the local
 * /api/media/file URL, or null on any failure (caller falls back to the raw URL).
 */
export async function downloadToMedia(
  url: string,
  deps?: { fetch?: FetchLike; now?: () => number; rand?: () => string },
): Promise<string | null> {
  try {
    const doFetch = deps?.fetch ?? (globalThis.fetch as FetchLike);
    const res = await doFetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    mkdirSync(MEDIA_DIR, { recursive: true });
    const now = deps?.now ? deps.now() : Date.now();
    const rand = deps?.rand ? deps.rand() : Math.random().toString(36).slice(2, 8);
    const ext = /\.mp4(\?|$)/i.test(url) ? "mp4" : "jpg";
    const filename = `insp_${now}_${rand}.${ext}`;
    writeFileSync(join(MEDIA_DIR, filename), buf);
    return `/api/media/file/${filename}`;
  } catch {
    return null;
  }
}
