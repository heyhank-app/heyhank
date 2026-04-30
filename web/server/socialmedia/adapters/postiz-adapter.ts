// ─── Postiz Adapter ──────────────────────────────────────────────────────────
// REST client for Postiz Public API v1.
// Works with both hosted (api.postiz.com) and self-hosted instances.
// Auth: raw API key in Authorization header (no Bearer prefix).
// API key found at: Settings → Developers → Public API

import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";
import type { SocialMediaAdapter } from "../adapter.js";
import type { SocialProfile, CreatePostInput, PostAnalytics, AccountAnalytics, SocialComment, SocialPlatform } from "../types.js";
import { getSettings as getAppSettings } from "../../settings-manager.js";
import { HEYHANK_HOME } from "../../paths.js";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/**
 * Detect the true MIME type from the file's magic bytes. Some generators
 * (e.g. Google's nanobanana MCP) save JPEG content under a `.png` filename,
 * which causes IG/X/Meta to reject the post because the declared content
 * type doesn't match the actual bytes. Always trust the bytes over the name.
 * Returns null if no known signature matches — caller falls back to extension.
 */
function detectMimeFromBytes(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  // WebP: RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  // MP4 (ISO BMFF): bytes 4-7 = "ftyp"
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return "video/mp4";
  return null;
}

// Instagram feed aspect ratio bounds (width / height).
// Spec is [0.8, 1.91] but we leave a safety margin to avoid rejections at
// the exact boundary (Instagram occasionally rounds and rejects 0.800).
const IG_ASPECT_MIN = 0.81;
const IG_ASPECT_MAX = 1.90;

// Canonical IG sizes — pad/resize to one of these so IG always accepts the
// container creation request.
const IG_PORTRAIT_W = 1080;
const IG_PORTRAIT_H = 1350; // 4:5
const IG_SQUARE = 1080;
const IG_LANDSCAPE_W = 1080;
const IG_LANDSCAPE_H = 566;  // ~1.91:1

/**
 * Normalize an image so Instagram's Graph API will accept it.
 *
 * Instagram returns the misleading error "Media fetch failed, please try
 * again" (error code 2207052) for several distinct reasons, all of which
 * we hit in practice:
 *   1. Aspect ratio outside [0.8, 1.91] (NB2 default 896×1200 = 0.747).
 *   2. JPEG written without a JFIF/Exif APP marker (Sharp's default
 *      output via `.jpeg()` after `.extend()`).
 *   3. Non-sRGB color space.
 *
 * To eliminate all three at once, we always re-encode through Sharp into
 * a canonical IG size (1080×1350 portrait, 1080×1080 square, 1080×566
 * landscape) as sRGB JPEG with explicit metadata. Padded background is
 * white. This is only invoked when Instagram is among the target
 * platforms, so other platforms still see the user's original image.
 */
async function normalizeForInstagram(
  buf: Buffer,
  inMime: string,
): Promise<{ buffer: Buffer; mime: string; changed: boolean }> {
  if (!inMime.startsWith("image/")) return { buffer: buf, mime: inMime, changed: false };
  // GIFs: IG doesn't accept GIF in feed, and Sharp would lose animation
  // frames anyway. Pass through untouched.
  if (inMime === "image/gif") return { buffer: buf, mime: inMime, changed: false };

  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return { buffer: buf, mime: inMime, changed: false };

  const aspect = w / h;

  // Choose the closest canonical canvas based on the original aspect.
  let targetW: number;
  let targetH: number;
  if (aspect < IG_ASPECT_MIN || aspect < 0.95) {
    targetW = IG_PORTRAIT_W;
    targetH = IG_PORTRAIT_H;
  } else if (aspect > IG_ASPECT_MAX || aspect > 1.5) {
    targetW = IG_LANDSCAPE_W;
    targetH = IG_LANDSCAPE_H;
  } else {
    targetW = IG_SQUARE;
    targetH = IG_SQUARE;
  }

  // `fit: contain` resizes the original to fit inside the target canvas
  // and pads the rest with the background color (white). No cropping.
  const out = await sharp(buf)
    .resize({
      width: targetW,
      height: targetH,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toColorspace("srgb")
    .jpeg({
      quality: 90,
      chromaSubsampling: "4:2:0",
      // `force: true` guarantees JPEG output even if input was PNG/WebP.
      force: true,
    })
    .withMetadata({ density: 72 })
    .toBuffer();

  return { buffer: out, mime: "image/jpeg", changed: true };
}

function extForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    case "video/webm": return "webm";
    default: return "bin";
  }
}

/**
 * Detect URLs that point to HeyHank's own media route. Works for both
 * absolute URLs (any host, e.g. the publicUrl) and relative paths.
 * Returns the bare filename if matched, else null.
 */
function extractLocalMediaFilename(url: string): string | null {
  try {
    // Normalize: strip protocol+host if present
    const withoutHost = url.replace(/^https?:\/\/[^/]+/i, "");
    const match = withoutHost.match(/^\/api\/media\/file\/([^/?#]+)/);
    if (!match) return null;
    return basename(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

const HOSTED_API = "https://api.postiz.com";

// Postiz uses different identifiers than our standard platform names
const PLATFORM_TO_POSTIZ: Record<string, string> = {
  twitter: "x",
  instagram: "instagram",
  linkedin: "linkedin",
  facebook: "facebook",
  tiktok: "tiktok",
  threads: "threads",
};

const POSTIZ_TO_PLATFORM: Record<string, SocialPlatform> = {
  x: "twitter",
  instagram: "instagram",
  linkedin: "linkedin",
  facebook: "facebook",
  tiktok: "tiktok",
  threads: "threads",
};

export class PostizAdapter implements SocialMediaAdapter {
  private baseUrl: string;
  private apiKey: string;
  /** Cached integrations (channel list) */
  private integrations: Array<{ id: string; name: string; identifier: string; picture: string | null }> | null = null;

  private apiPrefix: string;

  constructor(config: { url?: string; apiKey: string }) {
    const raw = (config.url || HOSTED_API).replace(/\/+$/, "");
    // Ensure we point to the API base, not the frontend
    this.baseUrl = raw.includes("/public/v1") ? raw.replace(/\/public\/v1.*/, "") : raw;
    // Hosted (api.postiz.com) uses /public/v1, self-hosted uses /api/public/v1
    this.apiPrefix = raw === HOSTED_API || !config.url ? "/public/v1" : "/api/public/v1";
    this.apiKey = config.apiKey;
  }

  private url(path: string): string {
    return `${this.baseUrl}${this.apiPrefix}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": this.apiKey,
    };
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; error?: string; data?: unknown }> {
    try {
      const res = await fetch(this.url("/is-connected"), { headers: this.headers() });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `Postiz returned ${res.status}: ${text || res.statusText}` };
      }
      const data = await res.json();
      if (data.connected) {
        return { ok: true, data };
      }
      return { ok: false, error: "Not connected" };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "Connection failed" };
    }
  }

  // ─── Integrations / Profiles ────────────────────────────────────────────────

  private async loadIntegrations(): Promise<typeof this.integrations> {
    if (this.integrations) return this.integrations;
    try {
      const res = await fetch(this.url("/integrations"), { headers: this.headers() });
      if (!res.ok) return [];
      const data = await res.json();
      this.integrations = (Array.isArray(data) ? data : []).map((item: any) => ({
        id: item.id ?? "",
        name: item.name ?? item.profile ?? item.identifier ?? "",
        identifier: item.identifier ?? "",
        picture: item.picture ?? null,
      }));
      return this.integrations;
    } catch {
      return [];
    }
  }

  async getProfiles(): Promise<SocialProfile[]> {
    const integrations = await this.loadIntegrations();
    return (integrations || []).map((item) => ({
      id: item.id,
      platform: (POSTIZ_TO_PLATFORM[item.identifier] ?? item.identifier) as SocialPlatform,
      name: item.name,
      picture: item.picture,
    }));
  }

  supportedPlatforms(): SocialPlatform[] {
    return ["twitter", "instagram", "linkedin", "facebook", "tiktok", "threads"];
  }

  // ─── Posts ──────────────────────────────────────────────────────────────────

  async createPost(input: CreatePostInput): Promise<{ id: string | null; status: string; backendData?: unknown }> {
    try {
      const integrations = await this.loadIntegrations();

      // Resolve integration IDs for selected platforms
      const matchedIntegrations = (integrations || []).filter((ig) => {
        const platform = POSTIZ_TO_PLATFORM[ig.identifier];
        return platform && input.platforms.includes(platform);
      });

      if (matchedIntegrations.length === 0) {
        return { id: null, status: "failed", backendData: { error: "No connected integrations match the selected platforms" } };
      }

      // Upload media. Two paths:
      //  1. Local HeyHank media (/api/media/file/<filename>): read from disk
      //     and upload as multipart — avoids Postiz hitting our Basic-Auth
      //     protected HTTP endpoint (which returns 500 / auth challenge).
      //  2. Other URLs: use Postiz /upload-from-url so Postiz fetches directly.
      const publicUrl = getAppSettings().publicUrl?.replace(/\/+$/, "") ?? "";
      const mediaItems: Array<{ id: string; path: string }> = [];
      const mediaUploadErrors: string[] = [];

      for (const mediaUrl of input.mediaUrls ?? []) {
        if (!mediaUrl) continue;

        // ── Path 1: local media file ──────────────────────────────────────
        const localFilename = extractLocalMediaFilename(mediaUrl);
        if (localFilename) {
          const localPath = join(HEYHANK_HOME, "media", localFilename);
          if (!existsSync(localPath)) {
            mediaUploadErrors.push(`Local media file not found: ${localFilename}`);
            continue;
          }
          try {
            const rawBuf = readFileSync(localPath);
            const extFromName = localFilename.split(".").pop()?.toLowerCase() ?? "";
            // Prefer magic-byte detection over extension. Some image generators
            // (e.g. nanobanana MCP) save JPEG content with a `.png` name, which
            // makes IG reject the post ("Media fetch failed") and X fail with
            // "bad_body" because the declared vs actual format disagree.
            const sniffedMime = detectMimeFromBytes(rawBuf);
            const baseMime = sniffedMime ?? MIME_BY_EXT[extFromName] ?? "application/octet-stream";

            // If Instagram is one of the targets, ensure the image aspect ratio
            // is within IG's accepted range. NB2 generates 896×1200 (0.747:1)
            // by default which IG rejects as "Media fetch failed". Pad to 4:5.
            let fileBuf: Buffer = rawBuf;
            let mime = baseMime;
            let normalized = false;
            if (input.platforms.includes("instagram")) {
              const norm = await normalizeForInstagram(rawBuf, baseMime);
              fileBuf = norm.buffer;
              mime = norm.mime;
              normalized = norm.changed;
            }

            // If the on-disk extension disagrees with the sniffed (or
            // re-encoded) content, rename the upload filename to the correct
            // extension so that Postiz / downstream CDNs serve it with a
            // matching Content-Type.
            const finalSniff = detectMimeFromBytes(fileBuf) ?? mime;
            const correctExt = finalSniff ? extForMime(finalSniff) : extFromName;
            const stem = localFilename.replace(/\.[^.]+$/, "");
            const uploadName = normalized
              ? `${stem}_ig${correctExt ? `.${correctExt}` : ""}`
              : correctExt && correctExt !== extFromName
                ? `${stem}.${correctExt}`
                : localFilename;
            const form = new FormData();
            form.append("file", new Blob([new Uint8Array(fileBuf)], { type: mime }), uploadName);

            // Do NOT set Content-Type — fetch/Blob sets the multipart boundary.
            const uploadRes = await fetch(this.url("/upload"), {
              method: "POST",
              headers: { Authorization: this.apiKey },
              body: form,
            });
            if (uploadRes.ok) {
              const uploadData = await uploadRes.json();
              if (uploadData.id && uploadData.path) {
                mediaItems.push({ id: uploadData.id, path: uploadData.path });
              } else {
                mediaUploadErrors.push(`Upload of "${localFilename}" returned unexpected payload`);
              }
            } else {
              const errText = await uploadRes.text().catch(() => "");
              mediaUploadErrors.push(`Upload of "${localFilename}" failed: ${uploadRes.status} ${errText || uploadRes.statusText}`);
            }
          } catch (err: any) {
            mediaUploadErrors.push(`Upload of "${localFilename}" threw: ${err?.message ?? "unknown"}`);
          }
          continue;
        }

        // ── Path 2: external URL via upload-from-url ──────────────────────
        let absoluteUrl: string | null = null;
        if (/^https?:\/\//i.test(mediaUrl)) {
          absoluteUrl = mediaUrl;
        } else if (mediaUrl.startsWith("/")) {
          absoluteUrl = publicUrl ? `${publicUrl}${mediaUrl}` : null;
        } else {
          absoluteUrl = mediaUrl;
        }
        if (!absoluteUrl) {
          mediaUploadErrors.push(`Cannot resolve media URL "${mediaUrl}" — publicUrl not configured`);
          continue;
        }
        try {
          const uploadRes = await fetch(this.url("/upload-from-url"), {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ url: absoluteUrl }),
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            if (uploadData.id && uploadData.path) {
              mediaItems.push({ id: uploadData.id, path: uploadData.path });
            } else {
              mediaUploadErrors.push(`Upload of "${absoluteUrl}" returned unexpected payload`);
            }
          } else {
            const errText = await uploadRes.text().catch(() => "");
            mediaUploadErrors.push(`Upload of "${absoluteUrl}" failed: ${uploadRes.status} ${errText || uploadRes.statusText}`);
          }
        } catch (err: any) {
          mediaUploadErrors.push(`Upload of "${absoluteUrl}" threw: ${err?.message ?? "unknown"}`);
        }
      }

      // If any media was requested but NONE uploaded successfully, fail the post
      // rather than silently publishing text-only — user expected the image.
      if (input.mediaUrls?.length && mediaItems.length === 0) {
        return {
          id: null,
          status: "failed",
          backendData: { error: "Media upload failed", details: mediaUploadErrors },
        };
      }

      // Platform-specific default settings required by Postiz.
      // These mirror the validation rules Postiz applies per integration:
      //  - Instagram/Facebook: post_type ("post" | "story")
      //  - X (Twitter): who_can_reply_post ("everyone" | "following" | "mentionedUsers" | "subscribers" | "verified")
      const SETTINGS_DEFAULTS: Record<string, Record<string, unknown>> = {
        instagram: { post_type: "post" },
        facebook: { post_type: "post" },
        x: { who_can_reply_post: "everyone" },
      };

      // Build post payload per Postiz API.
      // Postiz treats `value` as a thread — a second entry becomes the
      // first comment on IG/Facebook or a thread reply on X/Threads/LinkedIn.
      const firstCommentText = input.firstComment?.trim();
      const valueEntries: Array<{ content: string; image: Array<{ id: string; path: string }> }> = [
        { content: input.text, image: mediaItems },
      ];
      if (firstCommentText) {
        valueEntries.push({ content: firstCommentText, image: [] });
      }

      const postEntries = matchedIntegrations.map((ig) => ({
        integration: { id: ig.id },
        value: valueEntries,
        settings: {
          __type: ig.identifier,
          ...(SETTINGS_DEFAULTS[ig.identifier] ?? {}),
        },
      }));

      const body: Record<string, unknown> = {
        type: input.scheduledAt ? "schedule" : "now",
        date: input.scheduledAt || new Date().toISOString(),
        shortLink: false,
        tags: [],
        posts: postEntries,
      };

      const res = await fetch(this.url("/posts"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        return { id: null, status: "failed", backendData: data };
      }

      return {
        id: data.id ?? data.groupId ?? null,
        status: input.scheduledAt ? "scheduled" : "published",
        backendData: data,
      };
    } catch (err: any) {
      return { id: null, status: "failed", backendData: { error: err?.message } };
    }
  }

  async listPosts(opts?: { limit?: number }): Promise<Array<{ id: string; text: string; status: string; platforms: string[]; createdAt?: string | null; scheduledAt?: string | null }>> {
    try {
      // Postiz requires startDate/endDate
      const now = new Date();
      const endDate = new Date(now.getTime() + 30 * 86400000).toISOString(); // +30 days
      const startDate = new Date(now.getTime() - 90 * 86400000).toISOString(); // -90 days

      const res = await fetch(
        this.url(`/posts?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
        { headers: this.headers() },
      );
      if (!res.ok) return [];

      const data = await res.json();
      const posts = Array.isArray(data) ? data : data.posts ?? [];
      const limit = opts?.limit ?? 50;

      const STATE_MAP: Record<string, string> = {
        QUEUE: "scheduled",
        PUBLISHED: "published",
        ERROR: "failed",
        DRAFT: "draft",
      };

      return posts.slice(0, limit).map((p: any) => ({
        id: p.id ?? "",
        text: p.content ?? "",
        status: STATE_MAP[p.state] ?? p.state?.toLowerCase() ?? "unknown",
        platforms: p.integration?.identifier
          ? [POSTIZ_TO_PLATFORM[p.integration.identifier] ?? p.integration.identifier]
          : [],
        createdAt: p.createdAt ?? null,
        scheduledAt: p.publishDate ?? null,
      }));
    } catch {
      return [];
    }
  }

  async deletePost(postId: string): Promise<boolean> {
    try {
      const res = await fetch(this.url(`/posts/${postId}`), {
        method: "DELETE",
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── Analytics ──────────────────────────────────────────────────────────────

  async getAnalytics(postId: string): Promise<PostAnalytics> {
    try {
      const res = await fetch(this.url(`/analytics/post/${postId}?date=30`), { headers: this.headers() });
      if (!res.ok) return { impressions: 0, likes: 0, shares: 0, comments: 0 };
      const data = await res.json();
      if (data.missing) return { impressions: 0, likes: 0, shares: 0, comments: 0 };

      // Postiz returns array of { label, data: [{total, date}], percentageChange }
      const metrics = Array.isArray(data) ? data : [];
      const getValue = (label: string) => {
        const m = metrics.find((x: any) => x.label?.toLowerCase().includes(label));
        return m?.data?.reduce((sum: number, d: any) => sum + (parseInt(d.total) || 0), 0) ?? 0;
      };

      return {
        impressions: getValue("impression") || getValue("reach") || getValue("view"),
        likes: getValue("like") || getValue("favorite"),
        shares: getValue("share") || getValue("retweet") || getValue("repost"),
        comments: getValue("comment") || getValue("reply"),
      };
    } catch {
      return { impressions: 0, likes: 0, shares: 0, comments: 0 };
    }
  }

  async getAccountAnalytics(profileId: string): Promise<AccountAnalytics> {
    try {
      const res = await fetch(this.url(`/analytics/${profileId}?date=30`), { headers: this.headers() });
      if (!res.ok) return { followers: 0, following: 0, posts: 0 };
      const data = await res.json();

      const metrics = Array.isArray(data) ? data : [];
      const getLatest = (label: string) => {
        const m = metrics.find((x: any) => x.label?.toLowerCase().includes(label));
        const latest = m?.data?.[m.data.length - 1];
        return parseInt(latest?.total) || 0;
      };

      return {
        followers: getLatest("follower"),
        following: getLatest("following"),
        posts: getLatest("post") || getLatest("tweet"),
      };
    } catch {
      return { followers: 0, following: 0, posts: 0 };
    }
  }

  // ─── Comments (not supported by Postiz API) ────────────────────────────────

  async getComments(_postId: string): Promise<SocialComment[]> {
    return [];
  }

  async replyToComment(_postId: string, _commentId: string | null, _text: string): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: "Postiz does not support comment management via API" };
  }
}
