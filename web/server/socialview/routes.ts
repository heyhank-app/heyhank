// ─── SocialView Routes ───────────────────────────────────────────────────────
// REST endpoints for controlling the browser-based viewer.

import type { Hono } from "hono";
import * as browser from "./browser-manager.js";
import * as vnc from "./vnc-manager.js";
import * as library from "./library.js";
import { extractCurrentPage } from "./extractors.js";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "./types.js";

function parsePlatform(p: string): SocialPlatform | null {
  return SOCIAL_PLATFORMS.includes(p as SocialPlatform) ? (p as SocialPlatform) : null;
}

export function registerSocialViewRoutes(api: Hono): void {
  /** Status of all platforms + VNC infra. */
  api.get("/socialview/status", async (c) => {
    return c.json({
      vnc: await vnc.getVncStatus(),
      platforms: browser.getAllStatus(),
    });
  });

  /** Start a platform browser. Also boots VNC if needed. */
  api.post("/socialview/:platform/start", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    try {
      // startPlatform ensures Xvfb is up; VNC must come after so x11vnc can attach to :99
      const status = await browser.startPlatform(platform);
      await vnc.ensureVnc();
      return c.json({ ok: true, status, vnc: await vnc.getVncStatus() });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  /** Stop a platform browser (profile stays on disk). */
  api.post("/socialview/:platform/stop", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    try {
      await browser.stopPlatform(platform);
      return c.json({ ok: true, status: browser.getStatus(platform) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  /** Navigate an already-running browser to a URL (e.g. a profile page). */
  api.post("/socialview/:platform/goto", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    try {
      const body = (await c.req.json()) as { url?: string };
      if (!body.url) return c.json({ error: "url required" }, 400);
      const status = await browser.gotoUrl(platform, body.url);
      return c.json({ ok: true, status });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "failed" }, 500);
    }
  });

  /** Per-platform status. */
  api.get("/socialview/:platform/status", (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    return c.json(browser.getStatus(platform));
  });

  // ─── Extraction ─────────────────────────────────────────────────────
  /** Extract the post(s) currently visible on the platform's browser page.
   *  If the page is a profile, extracts the first N posts linked from it. */
  api.post("/socialview/:platform/extract", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        source?: "own" | "role-model";
      };
      const source = body.source === "role-model" ? "role-model" : "own";
      const page = browser.getPage(platform);
      if (!page) return c.json({ error: "platform not running — click Start first" }, 400);

      const result = await extractCurrentPage({ platform, page, source });
      // Persist each extracted post to library.
      for (const post of result.posts) library.savePost(post);
      return c.json({
        ok: true,
        extracted: result.posts.length,
        postIds: result.posts.map((p) => p.id),
        errors: result.errors,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "extract failed" }, 500);
    }
  });

  // ─── Library ────────────────────────────────────────────────────────
  /** List library posts with optional filters. */
  api.get("/socialview/library", (c) => {
    const params = c.req.query();
    const platform = params.platform ? parsePlatform(params.platform) : null;
    if (params.platform && !platform) return c.json({ error: "invalid platform" }, 400);
    const source = params.source === "own" || params.source === "role-model" ? params.source : undefined;
    const goldOnly = params.goldOnly === "true" || params.gold === "true";
    const minEngagementRate = params.minEngagement ? Number(params.minEngagement) : undefined;
    const tags = params.tags ? params.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const limit = params.limit ? Number(params.limit) : undefined;
    const posts = library.listPosts({
      platform: platform ?? undefined,
      source,
      goldOnly,
      minEngagementRate,
      tags,
      limit,
    });
    return c.json({ posts });
  });

  /** Update a library post (tags, isGold, source, notes). */
  api.patch("/socialview/library/:platform/:id", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    try {
      const body = (await c.req.json()) as {
        tags?: string[];
        isGold?: boolean;
        notes?: string;
        source?: "own" | "role-model";
      };
      const updated = library.updatePost(platform, c.req.param("id"), body);
      if (!updated) return c.json({ error: "not found" }, 404);
      return c.json({ ok: true, post: updated });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "update failed" }, 400);
    }
  });

  /** Delete a library post. */
  api.delete("/socialview/library/:platform/:id", (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    const ok = library.deletePost(platform, c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });
}
