// ─── Social Media Manager ────────────────────────────────────────────────────
// Business logic layer for social media operations.

import { randomUUID } from "node:crypto";
import type { SocialMediaAdapter } from "./adapter.js";
import type {
  SocialMediaSettings,
  SocialPost,
  CreatePostInput,
  PostAnalytics,
  AccountAnalytics,
  SocialComment,
  SocialProfile,
  ListPostsOpts,
  SocialPlatform,
} from "./types.js";
import * as store from "./store.js";
import { BrowserAdapter } from "./adapters/browser-adapter.js";

let cachedAdapter: SocialMediaAdapter | null = null;
let cachedBackendKey: string | null = null;

// Singleton BrowserAdapter — only one persistent Playwright session per platform,
// so there's no per-config variation to cache.
let browserAdapterSingleton: BrowserAdapter | null = null;

function getBrowserAdapter(): BrowserAdapter {
  if (!browserAdapterSingleton) browserAdapterSingleton = new BrowserAdapter();
  return browserAdapterSingleton;
}

/** Platforms routed through the browser (rather than the primary backend). */
function browserPlatformsFrom(settings: SocialMediaSettings): SocialPlatform[] {
  return settings.browserPlatforms ?? [];
}

/**
 * Coerce `platforms` input to a clean SocialPlatform[]. The Content Agent has
 * occasionally sent `[{id, name}]` objects (from a Postiz integration listing)
 * instead of plain strings, which corrupted drafts and crashed the UI.
 */
function coercePlatforms(input: unknown): SocialPlatform[] {
  if (!Array.isArray(input)) return [];
  const out: SocialPlatform[] = [];
  for (const p of input) {
    if (typeof p === "string" && p) { out.push(p as SocialPlatform); continue; }
    if (p && typeof p === "object") {
      const o = p as { name?: unknown; platform?: unknown };
      if (typeof o.name === "string" && o.name) { out.push(o.name as SocialPlatform); continue; }
      if (typeof o.platform === "string" && o.platform) { out.push(o.platform as SocialPlatform); continue; }
    }
  }
  return out;
}

export async function getAdapter(settings?: SocialMediaSettings): Promise<SocialMediaAdapter> {
  const s = settings ?? store.getSettings();
  if (!s.backend) {
    throw new Error("No social media backend configured");
  }

  const config = s.backends[s.backend];
  if (!config) {
    throw new Error(`No configuration found for backend: ${s.backend}`);
  }

  // Cache adapter if same backend + config
  const key = `${s.backend}:${config.apiKey}:${config.url ?? ""}`;
  if (cachedAdapter && cachedBackendKey === key) {
    return cachedAdapter;
  }

  let adapter: SocialMediaAdapter;

  switch (s.backend) {
    case "postiz": {
      const { PostizAdapter } = await import("./adapters/postiz-adapter.js");
      adapter = new PostizAdapter({ url: config.url ?? "", apiKey: config.apiKey });
      break;
    }
    case "buffer": {
      const { BufferAdapter } = await import("./adapters/buffer-adapter.js");
      adapter = new BufferAdapter({ apiKey: config.apiKey });
      break;
    }
    default:
      throw new Error(`Unknown social media backend: ${s.backend}`);
  }

  cachedAdapter = adapter;
  cachedBackendKey = key;
  return adapter;
}

export async function testConnection(): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  try {
    const adapter = await getAdapter();
    return await adapter.testConnection();
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

export async function getProfiles(): Promise<SocialProfile[]> {
  const adapter = await getAdapter();
  return adapter.getProfiles();
}

export async function createPost(input: CreatePostInput): Promise<SocialPost> {
  const settings = store.getSettings();
  const now = new Date().toISOString();

  // Defensive: agents have occasionally sent platforms as object arrays.
  input = { ...input, platforms: coercePlatforms(input.platforms) };

  const post: SocialPost = {
    id: randomUUID(),
    text: input.text,
    platforms: input.platforms,
    scheduledAt: input.scheduledAt ?? null,
    mediaUrls: input.mediaUrls ?? [],
    status: "draft",
    backendId: settings.backend,
    backendPostId: null,
    createdAt: now,
    updatedAt: now,
    title: input.title,
    firstComment: input.firstComment,
    videoUrl: input.videoUrl,
    thumbnailUrl: input.thumbnailUrl,
  };

  // If isDraft, save locally and return without calling backend
  if (input.isDraft) {
    post.backendId = null;
    store.savePost(post);
    return post;
  }

  // ── Partition platforms between Browser and primary backend ────────────────
  const browserSet = new Set(browserPlatformsFrom(settings));
  const browserPlatforms = input.platforms.filter((p) => browserSet.has(p));
  const primaryPlatforms = input.platforms.filter((p) => !browserSet.has(p));

  type GroupResult = {
    group: "browser" | "primary";
    ok: boolean;
    id: string | null;
    status: string;
    backendData?: unknown;
    error?: string;
  };
  const groupResults: GroupResult[] = [];

  // Primary backend group
  if (primaryPlatforms.length > 0) {
    try {
      const adapter = await getAdapter(settings);
      const result = await adapter.createPost({ ...input, platforms: primaryPlatforms });
      const ok = result.status === "published" || result.status === "scheduled";
      groupResults.push({
        group: "primary",
        ok,
        id: result.id,
        status: result.status,
        backendData: result.backendData,
      });
    } catch (err: any) {
      groupResults.push({
        group: "primary",
        ok: false,
        id: null,
        status: "failed",
        error: err?.message ?? "primary backend failed",
      });
    }
  }

  // Browser group (X / TikTok)
  if (browserPlatforms.length > 0) {
    try {
      const adapter = getBrowserAdapter();
      adapter.setTargetPlatforms(browserPlatforms);
      const result = await adapter.createPost({ ...input, platforms: browserPlatforms });
      const ok = result.status === "published" || result.status === "partial";
      groupResults.push({
        group: "browser",
        ok,
        id: result.id,
        status: result.status,
        backendData: result.backendData,
      });
    } catch (err: any) {
      groupResults.push({
        group: "browser",
        ok: false,
        id: null,
        status: "failed",
        error: err?.message ?? "browser adapter failed",
      });
    }
  }

  // ── Merge group results into a single SocialPost ───────────────────────────
  const anyOk = groupResults.some((g) => g.ok);
  const anyFail = groupResults.some((g) => !g.ok);
  // A primary-group result of "partial" also indicates a mixed outcome.
  const primaryGroupPartial = groupResults.find((g) => g.group === "primary")?.status === "partial";
  const browserGroupPartial = groupResults.find((g) => g.group === "browser")?.status === "partial";

  let finalStatus: SocialPost["status"];
  if (groupResults.length === 0) {
    finalStatus = "failed";
  } else if (anyOk && (anyFail || primaryGroupPartial || browserGroupPartial)) {
    finalStatus = "partial";
  } else if (anyOk) {
    // Could be "scheduled" if the primary group was scheduled and there was no browser group.
    const only = groupResults[0];
    finalStatus = (only?.status === "scheduled" ? "scheduled" : "published");
  } else {
    finalStatus = "failed";
  }

  // Build a structured backendPostId-ish payload in backendData; keep the flat
  // string field for backwards-compat (first available ID).
  const primaryRes = groupResults.find((g) => g.group === "primary");
  const browserRes = groupResults.find((g) => g.group === "browser");
  post.backendPostId = primaryRes?.id ?? browserRes?.id ?? null;
  post.backendData = {
    postiz: primaryRes
      ? {
          status: primaryRes.status,
          id: primaryRes.id,
          data: primaryRes.backendData,
          error: primaryRes.error,
        }
      : undefined,
    browser: browserRes
      ? {
          status: browserRes.status,
          id: browserRes.id,
          data: browserRes.backendData,
          error: browserRes.error,
        }
      : undefined,
  };
  post.status = finalStatus;

  post.updatedAt = new Date().toISOString();
  store.savePost(post);
  return post;
}

export async function listPosts(opts?: ListPostsOpts): Promise<SocialPost[]> {
  return store.listLocalPosts(opts);
}

export function getPost(id: string): SocialPost | null {
  return store.getPost(id);
}

/**
 * Move an already-published or scheduled post back to draft state.
 *
 * Best-effort deletes the post from the configured backend (Postiz/Buffer)
 * so it disappears from the platform queue / live feed, then resets the
 * local record to status="draft" with no backend reference. The user can
 * subsequently edit and re-publish via the normal draft flow.
 *
 * Note: this is destructive on the backend side — once the post is live on
 * Instagram/LinkedIn/etc., deleting from Postiz removes it from those
 * platforms (where the integration supports deletion). The local content
 * (text, media, scheduledAt) is preserved.
 */
export async function moveToDraft(id: string): Promise<SocialPost> {
  const post = store.getPost(id);
  if (!post) throw new Error("Post not found");
  if (post.status === "draft") return post;

  // Best-effort backend delete — don't block the local downgrade if the
  // backend has already cleaned up or the integration doesn't support it.
  if (post.backendPostId) {
    try {
      const adapter = await getAdapter();
      await adapter.deletePost(post.backendPostId);
    } catch (err: any) {
      console.error(`[socialmedia] moveToDraft: backend delete failed for ${post.backendPostId}:`, err?.message ?? err);
    }
  }

  post.status = "draft";
  post.backendId = null;
  post.backendPostId = null;
  post.backendData = undefined;
  post.updatedAt = new Date().toISOString();
  store.savePost(post);
  return post;
}

export async function deletePost(id: string): Promise<boolean> {
  const post = store.getPost(id);
  if (!post) return false;

  // Try to delete from backend if we have a backend post ID
  if (post.backendPostId) {
    try {
      const adapter = await getAdapter();
      await adapter.deletePost(post.backendPostId);
    } catch {
      // Continue with local deletion even if backend fails
    }
  }

  return store.deleteLocalPost(id);
}

/**
 * Archive or unarchive a post. Archiving hides the post from the default
 * Queue view without removing it; `previousStatus` is preserved in
 * `backendData._preArchiveStatus` so unarchiving restores the prior state.
 */
export async function setArchived(id: string, archived: boolean): Promise<SocialPost> {
  const post = store.getPost(id);
  if (!post) throw new Error("Post not found");

  if (archived) {
    if (post.status === "archived") return post;
    const data = (post.backendData as Record<string, unknown> | undefined) ?? {};
    post.backendData = { ...data, _preArchiveStatus: post.status };
    post.status = "archived";
  } else {
    const data = (post.backendData as Record<string, unknown> | undefined) ?? {};
    const prev = data._preArchiveStatus as SocialPost["status"] | undefined;
    post.status = prev ?? "published";
    if ("_preArchiveStatus" in data) {
      const { _preArchiveStatus: _, ...rest } = data;
      post.backendData = rest;
    }
  }

  post.updatedAt = new Date().toISOString();
  store.savePost(post);
  return post;
}

export async function getPostAnalytics(id: string): Promise<PostAnalytics> {
  const post = store.getPost(id);
  if (!post?.backendPostId) {
    return { impressions: 0, likes: 0, shares: 0, comments: 0 };
  }
  const adapter = await getAdapter();
  return adapter.getAnalytics(post.backendPostId);
}

export async function getAccountAnalytics(profileId: string): Promise<AccountAnalytics> {
  const adapter = await getAdapter();
  return adapter.getAccountAnalytics(profileId);
}

export async function getComments(postId: string): Promise<SocialComment[]> {
  const post = store.getPost(postId);
  if (!post?.backendPostId) return [];
  const adapter = await getAdapter();
  return adapter.getComments(post.backendPostId);
}

export async function replyToComment(postId: string, commentId: string | null, text: string): Promise<{ ok: boolean; error?: string }> {
  const post = store.getPost(postId);
  if (!post?.backendPostId) {
    return { ok: false, error: "Post not found or has no backend ID" };
  }
  const adapter = await getAdapter();
  return adapter.replyToComment(post.backendPostId, commentId, text);
}

export async function createDraft(input: CreatePostInput & { createdBy?: "user" | "gemini" | "agent" }): Promise<SocialPost> {
  const now = new Date().toISOString();
  const platforms = coercePlatforms(input.platforms);
  const post: SocialPost = {
    id: randomUUID(),
    text: input.text,
    platforms,
    scheduledAt: input.scheduledAt ?? null,
    mediaUrls: input.mediaUrls ?? [],
    status: "draft",
    backendId: null,
    backendPostId: null,
    createdAt: now,
    updatedAt: now,
    title: input.title,
    firstComment: input.firstComment,
    videoUrl: input.videoUrl,
    thumbnailUrl: input.thumbnailUrl,
    createdBy: input.createdBy ?? "user",
  };
  store.savePost(post);
  return post;
}

export async function updateDraft(id: string, updates: { text?: string; platforms?: string[]; scheduledAt?: string }): Promise<SocialPost> {
  const post = store.getPost(id);
  if (!post) throw new Error("Post not found");
  if (post.status !== "draft") throw new Error("Post is not a draft");

  if (updates.text !== undefined) post.text = updates.text;
  if (updates.platforms !== undefined) post.platforms = coercePlatforms(updates.platforms);
  if (updates.scheduledAt !== undefined) post.scheduledAt = updates.scheduledAt || null;
  post.updatedAt = new Date().toISOString();
  store.savePost(post);
  return post;
}

export async function deleteDraft(id: string): Promise<boolean> {
  const post = store.getPost(id);
  if (!post) return false;
  if (post.status !== "draft") throw new Error("Post is not a draft");
  return store.deleteLocalPost(id);
}

export async function publishDraft(id: string): Promise<SocialPost> {
  const post = store.getPost(id);
  if (!post) throw new Error("Post not found");
  if (post.status !== "draft") throw new Error("Post is not a draft");

  const settings = store.getSettings();
  try {
    const adapter = await getAdapter(settings);
    const result = await adapter.createPost({
      text: post.text,
      platforms: post.platforms,
      scheduledAt: post.scheduledAt,
      mediaUrls: post.mediaUrls,
    });
    post.backendId = settings.backend;
    post.backendPostId = result.id;
    post.status = result.status as SocialPost["status"];
    post.backendData = result.backendData;
  } catch (err: any) {
    post.status = "failed";
    post.backendData = { error: err?.message };
  }

  post.updatedAt = new Date().toISOString();
  store.savePost(post);
  return post;
}
