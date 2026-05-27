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
  SocialBackendId,
} from "./types.js";
import * as store from "./store.js";
import { BrowserAdapter } from "./adapters/browser-adapter.js";
import { autoCreateRulesForPost } from "./auto-rule-hook.js";

// Per-backend adapter cache. Keyed by `${backendId}:${apiKey}:${url}` so a
// settings change for one backend doesn't invalidate the others.
const adapterCache = new Map<string, SocialMediaAdapter>();

// Singleton BrowserAdapter — only one persistent Playwright session per platform,
// so there's no per-config variation to cache.
let browserAdapterSingleton: BrowserAdapter | null = null;

function getBrowserAdapter(): BrowserAdapter {
  if (!browserAdapterSingleton) browserAdapterSingleton = new BrowserAdapter();
  return browserAdapterSingleton;
}

/** Platforms routed through the browser (rather than any API backend). */
function browserPlatformsFrom(settings: SocialMediaSettings): SocialPlatform[] {
  return settings.browserPlatforms ?? [];
}

/**
 * Resolve which backend (or browser group) a given platform should be posted
 * through. Precedence: browserPlatforms > platformBackends override > primary
 * `backend`. Returns `null` only when there is no primary configured and the
 * platform has no override.
 */
function resolvePlatformBackend(
  platform: SocialPlatform,
  settings: SocialMediaSettings,
): "browser" | { backendId: string } | null {
  if (browserPlatformsFrom(settings).includes(platform)) return "browser";
  const override = settings.platformBackends?.[platform];
  if (override) return { backendId: override };
  if (settings.backend) return { backendId: settings.backend };
  return null;
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

/**
 * Get the adapter for a specific backend ID. If `backendId` is omitted, falls
 * back to the primary backend in settings. Caches per backend so secondary
 * routes (e.g. Buffer for TikTok) coexist with the primary (e.g. Postiz).
 */
export async function getAdapter(
  settings?: SocialMediaSettings,
  backendId?: SocialBackendId,
): Promise<SocialMediaAdapter> {
  const s = settings ?? store.getSettings();
  const id = backendId ?? s.backend;
  if (!id) {
    throw new Error("No social media backend configured");
  }

  const config = s.backends[id];
  if (!config) {
    throw new Error(`No configuration found for backend: ${id}`);
  }

  const key = `${id}:${config.apiKey}:${config.url ?? ""}`;
  const cached = adapterCache.get(key);
  if (cached) return cached;

  let adapter: SocialMediaAdapter;
  switch (id) {
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
      throw new Error(`Unknown social media backend: ${id}`);
  }

  adapterCache.set(key, adapter);
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
  // Collect profiles from every configured backend so platforms routed via
  // secondary backends (e.g. TikTok via Buffer) appear alongside primary ones.
  const settings = store.getSettings();
  const backendIds = new Set<SocialBackendId>();
  if (settings.backend) backendIds.add(settings.backend);
  for (const override of Object.values(settings.platformBackends ?? {})) {
    if (override) backendIds.add(override);
  }

  const seen = new Set<string>();
  const merged: SocialProfile[] = [];
  for (const id of backendIds) {
    try {
      const adapter = await getAdapter(settings, id);
      const profiles = await adapter.getProfiles();
      for (const p of profiles) {
        // Dedupe by (platform, id) so the same channel doesn't appear twice if
        // somehow returned by two backends.
        const k = `${p.platform}:${p.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(p);
      }
    } catch (err: any) {
      console.error(`[socialmedia] getProfiles failed for backend ${id}:`, err?.message ?? err);
    }
  }
  return merged;
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
    format: input.format,
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
    if (input.initialBackendData !== undefined) {
      post.backendData = input.initialBackendData;
    }
    store.savePost(post);
    return post;
  }

  // ── Partition platforms by resolved backend (browser / backendId) ──────────
  // Each platform routes to either the browser adapter or a specific API
  // backend, determined by `browserPlatforms` + `platformBackends` overrides +
  // the primary `backend`.
  const groups = new Map<string, SocialPlatform[]>();
  for (const p of input.platforms) {
    const target = resolvePlatformBackend(p, settings);
    if (!target) continue;
    const key = target === "browser" ? "browser" : target.backendId;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }

  type GroupResult = {
    group: string; // "browser" or a SocialBackendId
    platforms: SocialPlatform[];
    ok: boolean;
    id: string | null;
    status: string;
    backendData?: unknown;
    error?: string;
  };
  const groupResults: GroupResult[] = [];

  for (const [groupKey, platforms] of groups) {
    if (groupKey === "browser") {
      try {
        const adapter = getBrowserAdapter();
        adapter.setTargetPlatforms(platforms);
        const result = await adapter.createPost({ ...input, platforms });
        const ok = result.status === "published" || result.status === "partial";
        groupResults.push({
          group: "browser",
          platforms,
          ok,
          id: result.id,
          status: result.status,
          backendData: result.backendData,
        });
      } catch (err: any) {
        groupResults.push({
          group: "browser",
          platforms,
          ok: false,
          id: null,
          status: "failed",
          error: err?.message ?? "browser adapter failed",
        });
      }
    } else {
      try {
        const adapter = await getAdapter(settings, groupKey as SocialBackendId);
        const result = await adapter.createPost({ ...input, platforms });
        const ok = result.status === "published" || result.status === "scheduled";
        groupResults.push({
          group: groupKey,
          platforms,
          ok,
          id: result.id,
          status: result.status,
          backendData: result.backendData,
        });
      } catch (err: any) {
        groupResults.push({
          group: groupKey,
          platforms,
          ok: false,
          id: null,
          status: "failed",
          error: err?.message ?? `backend ${groupKey} failed`,
        });
      }
    }
  }

  // ── Merge group results into a single SocialPost ───────────────────────────
  const anyOk = groupResults.some((g) => g.ok);
  const anyFail = groupResults.some((g) => !g.ok);
  const anyPartial = groupResults.some((g) => g.status === "partial");

  let finalStatus: SocialPost["status"];
  if (groupResults.length === 0) {
    finalStatus = "failed";
  } else if (anyOk && (anyFail || anyPartial)) {
    finalStatus = "partial";
  } else if (anyOk) {
    // All ok → "scheduled" only if every group is scheduled.
    finalStatus = groupResults.every((g) => g.status === "scheduled") ? "scheduled" : "published";
  } else {
    finalStatus = "failed";
  }

  // Flatten group results into backendData keyed by group ID. Keep the
  // top-level backendPostId set to the first available ID for backwards-compat.
  post.backendPostId = groupResults.find((g) => g.id)?.id ?? null;
  const backendData: Record<string, unknown> = {};
  for (const g of groupResults) {
    backendData[g.group] = {
      platforms: g.platforms,
      status: g.status,
      id: g.id,
      data: g.backendData,
      error: g.error,
    };
  }
  post.backendData = backendData;
  post.status = finalStatus;

  post.updatedAt = new Date().toISOString();
  store.savePost(post);

  // Best-effort Auto-DM rule creation. Fires only when the post has reached a
  // backend (status published/scheduled/partial, backendData carries the
  // platform's post-id). Errors are non-fatal — the publish succeeded either
  // way, we just couldn't auto-wire the funnel.
  if (post.status !== "failed") {
    try {
      autoCreateRulesForPost(post);
    } catch (err) {
      console.error(`[socialmedia] auto-rule hook failed for ${post.id}:`, err instanceof Error ? err.message : err);
    }
  }

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
    format: input.format,
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

  // Re-run createPost with isDraft=false to reuse the same per-platform routing
  // logic. Wipe the draft from disk so createPost can save the published copy
  // under the same ID (createPost generates a new id via randomUUID, so we set
  // it back after).
  const settings = store.getSettings();
  const published = await createPost({
    text: post.text,
    platforms: post.platforms,
    scheduledAt: post.scheduledAt,
    mediaUrls: post.mediaUrls,
    format: post.format,
    firstComment: post.firstComment,
    title: post.title,
    videoUrl: post.videoUrl,
    thumbnailUrl: post.thumbnailUrl,
    isDraft: false,
  });

  // Preserve the original draft ID + creation timestamp so the UI can keep
  // tracking the same record across the draft→published transition.
  store.deleteLocalPost(published.id);
  published.id = post.id;
  published.createdAt = post.createdAt;
  // The createPost call captures backendId per group via backendData; keep the
  // primary backend on the flat field for any caller that still reads it.
  published.backendId = settings.backend;
  store.savePost(published);
  return published;
}
