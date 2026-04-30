// ─── SocialView Routes ───────────────────────────────────────────────────────
// REST endpoints for controlling the browser-based viewer.

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as browser from "./browser-manager.js";
import * as vnc from "./vnc-manager.js";
import * as library from "./library.js";
import * as styleProfiles from "./style-profiles.js";
import { analyzeHandleStyle } from "./style-analyzer.js";
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

  // ─── Debug: dump permalink page DOM ─────────────────────────────────
  // POST { url } → opens the permalink in a background tab using the live
  // FB browser context, expands all comments, and writes the rendered HTML +
  // a JSON analysis of comment-container candidates to /tmp/. Used to refine
  // the comment-extraction selectors when the live extractor returns 0
  // own-comments. Temporary; safe to remove once selectors are stable.
  api.post("/socialview/:platform/debug-permalink", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    const page = browser.getPage(platform);
    if (!page) return c.json({ error: `${platform} not running` }, 400);
    const body = (await c.req.json()) as { url?: string; ownerHandle?: string };
    if (!body.url) return c.json({ error: "url required" }, 400);
    const owner = (body.ownerHandle || "").toLowerCase();

    const tab = await page.context().newPage();
    try {
      await tab.goto(body.url, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await tab.waitForTimeout(2500);

      // Expand comments + replies repeatedly.
      for (let pass = 0; pass < 6; pass++) {
        const clicked = await tab.evaluate(() => {
          const cands = Array.from(
            document.querySelectorAll("div[role='button'], span[role='button'], span"),
          ) as HTMLElement[];
          const re = /^(weitere kommentare anzeigen|view more comments|alle kommentare anzeigen|view all comments|previous comments|vorherige kommentare|antworten anzeigen|view replies?|view all \d+ replies?|\d+ antworten|\d+ replies?|kommentar(e)? anzeigen|see more|mehr anzeigen|weiterlesen)$/i;
          let n = 0;
          for (const el of cands) {
            if (!el.isConnected) continue;
            const t = (el.textContent || "").trim();
            if (!t || t.length > 60) continue;
            if (re.test(t)) {
              try { el.click(); n++; } catch { /* noop */ }
            }
          }
          return n;
        }).catch(() => 0);
        if (!clicked) break;
        await tab.waitForTimeout(900);
      }

      // Analyse + dump.
      const analysis = await tab.evaluate(({ owner }) => {
        const seen: string[] = [];
        // Find anything that looks like a comment container.
        const articleNodes = Array.from(document.querySelectorAll("[role='article']")) as HTMLElement[];
        const articleInfo = articleNodes.map((el, i) => ({
          idx: i,
          ariaLabel: el.getAttribute("aria-label") || "",
          hasVerfasser: !!Array.from(el.querySelectorAll("span, div")).find((s) => {
            const t = (s.textContent || "").trim();
            return t === "Verfasser" || t === "Author";
          }),
          authorLinks: Array.from(el.querySelectorAll("a[href]"))
            .slice(0, 8)
            .map((a) => (a as HTMLAnchorElement).getAttribute("href") || ""),
          textPreview: (el.innerText || "").trim().slice(0, 200),
        }));

        // Standalone "Verfasser"-tagged elements (not inside role='article').
        const verfasserNodes = Array.from(document.querySelectorAll("span, div"))
          .filter((el) => {
            const t = (el.textContent || "").trim();
            return t === "Verfasser" || t === "Author";
          })
          .map((el, i) => {
            // Walk up to find the comment unit.
            let cur: HTMLElement | null = el as HTMLElement;
            const ancestry: string[] = [];
            for (let k = 0; k < 8 && cur; k++) {
              cur = cur.parentElement;
              if (!cur) break;
              ancestry.push(`${cur.tagName.toLowerCase()}${cur.getAttribute("role") ? `[role=${cur.getAttribute("role")}]` : ""}`);
            }
            return { idx: i, ancestry: ancestry.slice(0, 6).join(" > ") };
          });

        return {
          url: location.href,
          title: document.title,
          totalArticles: articleNodes.length,
          articleInfo,
          verfasserCount: verfasserNodes.length,
          verfasserPaths: verfasserNodes.slice(0, 12),
          owner,
        };
      }, { owner });

      const fs = await import("node:fs/promises");
      const html = await tab.content();
      await fs.writeFile("/tmp/fb-permalink-debug.html", html.slice(0, 1_500_000));
      await fs.writeFile("/tmp/fb-permalink-debug.json", JSON.stringify(analysis, null, 2));
      return c.json({ ok: true, analysis });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    } finally {
      await tab.close().catch(() => { /* noop */ });
    }
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

  /**
   * Streaming variant of /extract. Returns Server-Sent Events so the frontend
   * can render live progress (current URL, detected mode, per-post links,
   * success / failure for each).
   *
   * Event types (all data is JSON):
   *   log   — {message}
   *   url   — {url}            current browser URL at start
   *   mode  — {mode, maxPosts} detected extraction mode
   *   post  — {index, total, href, ok, error?, title?}
   *   done  — {extracted, errors, postIds}
   *   fatal — {error}
   */
  api.post("/socialview/:platform/extract-stream", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);

    const body = (await c.req.json().catch(() => ({}))) as { source?: "own" | "role-model" };
    const source = body.source === "role-model" ? "role-model" : "own";

    return streamSSE(c, async (stream) => {
      const send = async (event: string, data: unknown) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      try {
        const page = browser.getPage(platform);
        if (!page) {
          await send("fatal", { error: "platform not running — click Start first" });
          return;
        }
        await send("url", { url: page.url() });

        const result = await extractCurrentPage({
          platform,
          page,
          source,
          onLog: async (msg) => { await send("log", { message: msg }); },
        });
        for (const post of result.posts) library.savePost(post);

        await send("done", {
          extracted: result.posts.length,
          postIds: result.posts.map((p) => p.id),
          errors: result.errors,
        });
      } catch (e) {
        await send("fatal", { error: e instanceof Error ? e.message : "extract failed" });
      }
    });
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

  // ─── Style Profiles ──────────────────────────────────────────────────
  /** List all style profiles. */
  api.get("/socialview/style-profiles", (c) => {
    return c.json({ profiles: styleProfiles.listProfiles() });
  });

  /** Get a single style profile. */
  api.get("/socialview/style-profiles/:platform/:handle", (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    const profile = styleProfiles.getProfile(platform, c.req.param("handle"));
    if (!profile) return c.json({ error: "not found" }, 404);
    return c.json(profile);
  });

  /**
   * Generate (or regenerate) a style profile for a handle by running an
   * LLM analysis over all library posts of that handle. Returns the new
   * profile.
   */
  api.post("/socialview/style-profiles/:platform/:handle/analyze", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    try {
      const profile = await analyzeHandleStyle(platform, c.req.param("handle"));
      return c.json({ ok: true, profile });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "analysis failed" }, 500);
    }
  });

  /** Manually edit fields of a style profile. */
  api.patch("/socialview/style-profiles/:platform/:handle", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    const handle = c.req.param("handle");
    const existing = styleProfiles.getProfile(platform, handle);
    if (!existing) return c.json({ error: "not found" }, 404);
    try {
      const body = await c.req.json();
      const updated = {
        ...existing,
        ...body,
        // Don't let the client overwrite identity / audit fields.
        id: existing.id,
        platform: existing.platform,
        handle: existing.handle,
        basedOnPostIds: existing.basedOnPostIds,
        basedOnPostCount: existing.basedOnPostCount,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      styleProfiles.saveProfile(updated);
      return c.json({ ok: true, profile: updated });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "update failed" }, 400);
    }
  });

  /** Delete a style profile. */
  api.delete("/socialview/style-profiles/:platform/:handle", (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    const ok = styleProfiles.deleteProfile(platform, c.req.param("handle"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });
}
