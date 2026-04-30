// ─── Social Media Routes ─────────────────────────────────────────────────────
// REST API for social media posting, scheduling, analytics, and comments.

import type { Hono } from "hono";
import * as store from "../socialmedia/store.js";
import * as manager from "../socialmedia/manager.js";
import * as browser from "../socialview/browser-manager.js";
import type { SocialPlatform as ViewPlatform } from "../socialview/types.js";

export function registerSocialMediaRoutes(api: Hono): void {
  // ─── Settings ───────────────────────────────────────────────────────

  /** Get settings (API keys masked) */
  api.get("/socialmedia/settings", (c) => {
    try {
      const settings = store.getSettings();
      // Mask API keys
      const masked = JSON.parse(JSON.stringify(settings));
      for (const [, cfg] of Object.entries(masked.backends || {})) {
        const conf = cfg as { apiKey?: string };
        if (conf.apiKey) conf.apiKey = conf.apiKey.slice(0, 4) + "••••••••";
      }
      return c.json(masked);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  /** Save settings (restore masked keys from existing) */
  api.put("/socialmedia/settings", async (c) => {
    try {
      const body = await c.req.json();
      const existing = store.getSettings();
      // Restore masked keys from existing settings
      for (const [key, cfg] of Object.entries(body.backends || {})) {
        const conf = cfg as { apiKey?: string };
        if (conf.apiKey && conf.apiKey.includes("••••")) {
          const existingKey = (existing.backends as Record<string, { apiKey?: string }>)?.[key]?.apiKey;
          if (existingKey) conf.apiKey = existingKey;
        }
      }
      store.saveSettings(body);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "bad request" }, 400);
    }
  });

  // ─── Connection ─────────────────────────────────────────────────────

  /** Test backend connection */
  api.post("/socialmedia/test-connection", async (c) => {
    try {
      const result = await manager.testConnection();
      return c.json(result);
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  });

  /**
   * Browser-backed status for the platforms we post via Playwright
   * (X / Twitter and TikTok). Other platforms continue to use the
   * primary backend (Postiz).
   */
  api.get("/socialmedia/browser-status", (c) => {
    const platforms: ViewPlatform[] = ["twitter", "tiktok"];
    const statuses = platforms.map((p) => {
      const s = browser.getStatus(p);
      return {
        platform: p,
        running: s.running,
        loggedIn: s.loggedIn,
        currentUrl: s.currentUrl,
        hasProfile: browser.hasProfile(p),
      };
    });
    return c.json({ platforms: statuses });
  });

  /** Get connected profiles */
  api.get("/socialmedia/profiles", async (c) => {
    try {
      const profiles = await manager.getProfiles();
      return c.json({ profiles });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  // ─── Posts ──────────────────────────────────────────────────────────

  /** Create post */
  api.post("/socialmedia/posts", async (c) => {
    try {
      const body = await c.req.json();
      const text = (body.text || "").trim();
      if (!text) return c.json({ error: "text required" }, 400);
      // Accept both mediaUrls (array) and imageUrl (string) for compatibility
      let mediaUrls: string[] = body.mediaUrls || [];
      if (mediaUrls.length === 0 && body.imageUrl) {
        mediaUrls = [body.imageUrl];
      }
      const result = await manager.createPost({
        text,
        platforms: body.platforms || [],
        scheduledAt: body.scheduledAt || null,
        mediaUrls,
        isDraft: body.isDraft ?? false,
        title: body.title,
        firstComment: body.firstComment,
        videoUrl: body.videoUrl,
        thumbnailUrl: body.thumbnailUrl,
      });
      if (body.createdBy && result) (result as any).createdBy = body.createdBy;
      return c.json(result, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  /** List posts */
  api.get("/socialmedia/posts", async (c) => {
    const opts: { status?: string; platform?: string; limit?: number } = {};
    const status = c.req.query("status");
    const platform = c.req.query("platform");
    const limit = c.req.query("limit");
    if (status) opts.status = status;
    if (platform) opts.platform = platform;
    if (limit) opts.limit = parseInt(limit, 10);
    const posts = await manager.listPosts(opts);
    return c.json({ posts });
  });

  /** Get single post */
  api.get("/socialmedia/posts/:id", async (c) => {
    const post = await manager.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "post not found" }, 404);
    return c.json(post);
  });

  /** Update/reschedule post */
  api.patch("/socialmedia/posts/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const post = store.getPost(id);
      if (!post) return c.json({ error: "post not found" }, 404);
      if (body.text !== undefined) post.text = body.text;
      if (body.scheduledAt !== undefined) post.scheduledAt = body.scheduledAt;
      if (body.platforms !== undefined) {
        // Coerce object-array shapes (`[{id, name}]`) back to string[].
        if (Array.isArray(body.platforms)) {
          post.platforms = body.platforms
            .map((p: unknown) => {
              if (typeof p === "string") return p;
              if (p && typeof p === "object") {
                const o = p as { name?: unknown; platform?: unknown };
                if (typeof o.name === "string") return o.name;
                if (typeof o.platform === "string") return o.platform;
              }
              return null;
            })
            .filter((s: unknown): s is string => typeof s === "string" && s.length > 0);
        }
      }
      if (body.scheduledAt && post.status === "published") post.status = "scheduled";
      store.savePost(post);
      return c.json(post);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "bad request" }, 400);
    }
  });

  /** Publish draft */
  api.post("/socialmedia/posts/:id/publish", async (c) => {
    try {
      const smManager = await import("../socialmedia/manager.js");
      const post = await smManager.publishDraft(c.req.param("id"));
      return c.json(post);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to publish" }, 400);
    }
  });

  /** Move a published/scheduled/failed post back to draft (deletes from backend) */
  api.post("/socialmedia/posts/:id/move-to-draft", async (c) => {
    try {
      const post = await manager.moveToDraft(c.req.param("id"));
      return c.json(post);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  /** Delete post */
  api.delete("/socialmedia/posts/:id", async (c) => {
    const ok = await manager.deletePost(c.req.param("id"));
    return c.json({ ok }, ok ? 200 : 404);
  });

  /** Archive post (hide from default queue view) */
  api.post("/socialmedia/posts/:id/archive", async (c) => {
    try {
      const post = await manager.setArchived(c.req.param("id"), true);
      return c.json(post);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 400);
    }
  });

  /** Unarchive post (restore previous status) */
  api.post("/socialmedia/posts/:id/unarchive", async (c) => {
    try {
      const post = await manager.setArchived(c.req.param("id"), false);
      return c.json(post);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 400);
    }
  });

  /** Get post analytics */
  api.get("/socialmedia/posts/:id/analytics", async (c) => {
    try {
      const analytics = await manager.getPostAnalytics(c.req.param("id"));
      return c.json(analytics);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  /** Get post comments */
  api.get("/socialmedia/posts/:id/comments", async (c) => {
    try {
      const comments = await manager.getComments(c.req.param("id"));
      return c.json({ comments });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  /** Reply to comment */
  api.post("/socialmedia/posts/:id/comments", async (c) => {
    try {
      const body = await c.req.json();
      const text = (body.text || "").trim();
      if (!text) return c.json({ error: "text required" }, 400);
      const result = await manager.replyToComment(c.req.param("id"), body.commentId || null, text);
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  // ─── Calendar View ──────────────────────────────────────────────────

  /** Get posts grouped by day for a month */
  api.get("/socialmedia/calendar", (c) => {
    try {
      const month = c.req.query("month") || new Date().toISOString().slice(0, 7);
      const allPosts = store.listLocalPosts({});
      const grouped: Record<string, typeof allPosts> = {};
      for (const p of allPosts) {
        const dateStr = (p.scheduledAt || p.createdAt || "").slice(0, 10);
        if (!dateStr.startsWith(month)) continue;
        if (!grouped[dateStr]) grouped[dateStr] = [];
        grouped[dateStr].push(p);
      }
      return c.json({ month, days: grouped });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  // ─── Hashtag Pools ─────────────────────────────────────────────────

  /** List all hashtag pools */
  api.get("/socialmedia/hashtag-pools", (c) => {
    try {
      const pools = store.listHashtagPools();
      return c.json({ pools });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  /** Get single hashtag pool */
  api.get("/socialmedia/hashtag-pools/:id", (c) => {
    const pool = store.getHashtagPool(c.req.param("id"));
    if (!pool) return c.json({ error: "pool not found" }, 404);
    return c.json(pool);
  });

  /** Create or update hashtag pool */
  api.post("/socialmedia/hashtag-pools", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.name) return c.json({ error: "name required" }, 400);
      const { randomUUID } = await import("node:crypto");
      const now = new Date().toISOString();
      const pool = {
        id: body.id || randomUUID(),
        name: body.name,
        industry: body.industry || "",
        language: body.language || "de",
        popular: body.popular || [],
        medium: body.medium || [],
        niche: body.niche || [],
        branded: body.branded || [],
        blocked: body.blocked || [],
        createdAt: body.createdAt || now,
        updatedAt: now,
      };
      store.saveHashtagPool(pool);
      return c.json(pool, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "bad request" }, 400);
    }
  });

  /** Update hashtag pool */
  api.put("/socialmedia/hashtag-pools/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const existing = store.getHashtagPool(id);
      if (!existing) return c.json({ error: "pool not found" }, 404);
      const body = await c.req.json();
      const pool = {
        ...existing,
        ...body,
        id, // don't allow id change
        updatedAt: new Date().toISOString(),
      };
      store.saveHashtagPool(pool);
      return c.json(pool);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "bad request" }, 400);
    }
  });

  /** Delete hashtag pool */
  api.delete("/socialmedia/hashtag-pools/:id", (c) => {
    const ok = store.deleteHashtagPool(c.req.param("id"));
    return c.json({ ok }, ok ? 200 : 404);
  });

  // ─── Account Analytics ──────────────────────────────────────────────

  /** Get account analytics for a profile */
  api.get("/socialmedia/analytics/:profileId", async (c) => {
    try {
      const analytics = await manager.getAccountAnalytics(c.req.param("profileId"));
      return c.json(analytics);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });
}
