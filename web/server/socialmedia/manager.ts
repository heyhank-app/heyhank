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
} from "./types.js";
import * as store from "./store.js";

let cachedAdapter: SocialMediaAdapter | null = null;
let cachedBackendKey: string | null = null;

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

  try {
    const adapter = await getAdapter(settings);
    const result = await adapter.createPost(input);
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

export async function listPosts(opts?: ListPostsOpts): Promise<SocialPost[]> {
  return store.listLocalPosts(opts);
}

export function getPost(id: string): SocialPost | null {
  return store.getPost(id);
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
  const post: SocialPost = {
    id: randomUUID(),
    text: input.text,
    platforms: input.platforms,
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
  if (updates.platforms !== undefined) post.platforms = updates.platforms as SocialPost["platforms"];
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
