// ─── SocialView Routes ───────────────────────────────────────────────────────
// REST endpoints for controlling the browser-based viewer.

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as browser from "./browser-manager.js";
import * as vnc from "./vnc-manager.js";
import * as library from "./library.js";
import * as styleProfiles from "./style-profiles.js";
import * as watchList from "./watch-list.js";
import * as autoCrawler from "./auto-crawler.js";
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
  /**
   * Import cookies exported from the user's normal browser (where they're
   * already logged in and not shadow-banned). Bypasses platform login flows
   * entirely — Playwright shows up to the platform as an authenticated user.
   *
   * Body: { cookies: [...] } in either Playwright-native shape or the JSON
   * shape emitted by Cookie-Editor / EditThisCookie browser extensions. The
   * browser-manager normalizer handles both.
   */
  api.post("/socialview/:platform/import-cookies", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    try {
      const body = await c.req.json();
      const cookies = body.cookies ?? body; // accept bare array too
      const result = await browser.applyCookies(platform, cookies);
      return c.json({ ok: true, ...result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "import failed" }, 400);
    }
  });

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

  /**
   * One-shot DOM diagnostic — what selectors / structure does the current
   * page expose? Used to refine extractors when platforms ship DOM changes.
   * Returns counts of common selectors + the first few characters of likely
   * content nodes. NOT meant for routine use.
   */
  /**
   * Dump TikTok hydration-script content so we can inspect schema changes
   * when the extractor returns 0 posts. Returns the first 4 KB of the
   * `__UNIVERSAL_DATA_FOR_REHYDRATION__` script tag (or null if missing) plus
   * the top-level keys of __DEFAULT_SCOPE__ so we can see what slots TikTok is
   * actually shipping.
   */
  /** Dump itemStruct from current page (for stats-schema discovery). */
  api.get("/socialview/tiktok/inspect-item", async (c) => {
    const page = browser.getPage("tiktok");
    if (!page) return c.json({ error: "tiktok not running" }, 400);
    const data = await page.evaluate(() => {
      const el = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
      if (!el?.textContent) return { error: "no hydration" };
      try {
        const parsed = JSON.parse(el.textContent) as { __DEFAULT_SCOPE__?: Record<string, unknown> };
        const scope = parsed.__DEFAULT_SCOPE__ ?? {};
        const videoDetail = scope["webapp.video-detail"] as { itemInfo?: { itemStruct?: Record<string, unknown> } } | undefined;
        const item = videoDetail?.itemInfo?.itemStruct ?? null;
        if (!item) return { error: "no itemStruct" };
        return {
          topLevelKeys: Object.keys(item),
          stats: item.stats,
          statsV2: item.statsV2,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
    return c.json(data);
  });

  /**
   * Call TikTok's internal `/api/post/item_list/` from inside the page so the
   * webmssdk auto-signs the request. Returns the raw response so we can see
   * whether the API is reachable from this Playwright session at all.
   */
  api.get("/socialview/tiktok/fetch-items/:secUid", async (c) => {
    const page = browser.getPage("tiktok");
    if (!page) return c.json({ error: "tiktok not running" }, 400);
    const secUid = c.req.param("secUid");
    const data = await page.evaluate(async (sid: string) => {
      try {
        const url =
          "/api/post/item_list/" +
          `?aid=1988&app_language=en&app_name=tiktok_web&channel=tiktok_web` +
          `&count=20&cursor=0` +
          `&device_platform=web_pc&secUid=${encodeURIComponent(sid)}`;
        const res = await fetch(url, { credentials: "include" });
        const text = await res.text();
        return { status: res.status, contentType: res.headers.get("content-type"), bodyPreview: text.slice(0, 400), bodyLength: text.length };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }, secUid);
    return c.json(data);
  });

  /** Dump all anchor hrefs visible on the current TikTok page (debug). */
  api.get("/socialview/tiktok/inspect-anchors", async (c) => {
    const page = browser.getPage("tiktok");
    if (!page) return c.json({ error: "tiktok not running" }, 400);
    const data = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a")) as HTMLAnchorElement[];
      const hrefs = anchors.map((a) => a.getAttribute("href") || "").filter(Boolean);
      const videoHrefs = hrefs.filter((h) => /\/@[^/]+\/(video|photo)\/\d+/.test(h));
      const e2eItems = Array.from(document.querySelectorAll('[data-e2e="user-post-item"]')).length;
      const e2eList = Array.from(document.querySelectorAll('[data-e2e="user-post-item-list"]')).length;
      return {
        url: location.href,
        totalAnchors: anchors.length,
        videoMatchingAnchors: videoHrefs.length,
        e2eUserPostItems: e2eItems,
        e2eUserPostItemList: e2eList,
        firstVideoHrefs: videoHrefs.slice(0, 3),
        firstAnyHrefs: hrefs.slice(0, 10),
      };
    });
    return c.json(data);
  });

  /** Inspect the actual video tile HTML inside the grid container. */
  api.get("/socialview/tiktok/inspect-tiles", async (c) => {
    const page = browser.getPage("tiktok");
    if (!page) return c.json({ error: "tiktok not running" }, 400);
    const data = await page.evaluate(() => {
      // Find the VIDEO grid by large-thumbnail-image heuristic. Video tiles
      // are typically 280x500 ish; suggested-user avatars are 100x100, so we
      // filter on min dimensions to skip the sidebar.
      const imgs = (Array.from(document.querySelectorAll("img")) as HTMLImageElement[])
        .filter((i) => i.naturalWidth >= 200 && i.naturalHeight >= 200);
      const candidateGrids = new Map<HTMLElement, number>();
      for (const img of imgs) {
        let el: HTMLElement | null = img.parentElement;
        for (let depth = 0; depth < 8 && el; depth++) {
          const sibs = el.parentElement?.children ?? [];
          if (sibs.length >= 5) {
            candidateGrids.set(el.parentElement!, (candidateGrids.get(el.parentElement!) ?? 0) + 1);
            break;
          }
          el = el.parentElement;
        }
      }
      const sorted = Array.from(candidateGrids.entries()).sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      if (!top) {
        return { error: "no video grid candidate found", imgCount: imgs.length, candidateCount: candidateGrids.size };
      }
      const grid = top[0] as HTMLElement;
      const childCount = grid.children.length;
      const samples: Array<{ idx: number; tag: string; html: string }> = [];
      // Skip child 0 (often a virtualization spacer) and dump children 1-3.
      for (let i = 1; i < Math.min(4, childCount); i++) {
        const c = grid.children[i] as HTMLElement;
        samples.push({ idx: i, tag: c.tagName, html: (c.outerHTML ?? "").slice(0, 1500) });
      }
      return {
        childCount,
        imgCount: imgs.length,
        gridClass: grid.className?.slice(0, 100),
        gridParentClass: grid.parentElement?.className?.slice(0, 100),
        samples,
      };
    });
    return c.json(data);
  });

  /** Full HTML/DOM dump (4 KB extract per area) for selector-discovery. */
  api.get("/socialview/tiktok/inspect-full", async (c) => {
    const page = browser.getPage("tiktok");
    if (!page) return c.json({ error: "tiktok not running" }, 400);
    const data = await page.evaluate(() => {
      const root = document.body;
      // Look for any element that visually looks like a video tile (has an
      // image > 100px wide and the parent has multiple siblings of similar
      // structure → grid).
      const imgs = Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
      const candidateGrids = new Map<HTMLElement, number>();
      for (const img of imgs) {
        if (img.naturalWidth < 100) continue;
        // Walk up 4 ancestors looking for a container that has 5+ image-bearing children.
        let el: HTMLElement | null = img.parentElement;
        for (let depth = 0; depth < 5 && el; depth++) {
          const sibs = el.parentElement?.children ?? [];
          if (sibs.length >= 5) {
            candidateGrids.set(el.parentElement!, (candidateGrids.get(el.parentElement!) ?? 0) + 1);
            break;
          }
          el = el.parentElement;
        }
      }
      const grids = Array.from(candidateGrids.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([el, count]) => ({
          count,
          tag: el.tagName,
          className: (el.className || "").slice(0, 200),
          dataset: JSON.stringify(Object.fromEntries(Object.entries((el as HTMLElement).dataset))),
          firstChildHTML: (el.firstElementChild?.outerHTML ?? "").slice(0, 500),
        }));
      // Also find any href with the profile's numeric user ID
      const match = location.href.match(/\/@([^/?#]+)/);
      const handle = match?.[1] ?? "";
      const matchHandle = `/@${handle}/`;
      const handleHrefs = Array.from(document.querySelectorAll("a"))
        .map((a) => a.getAttribute("href") || "")
        .filter((h) => h.startsWith(matchHandle))
        .slice(0, 10);
      return {
        url: location.href,
        handle,
        bodySize: root?.innerHTML.length ?? 0,
        candidateGrids: grids,
        handleVideoHrefs: handleHrefs,
      };
    });
    return c.json(data);
  });

  api.get("/socialview/tiktok/inspect-hydration", async (c) => {
    const page = browser.getPage("tiktok");
    if (!page) return c.json({ error: "tiktok not running" }, 400);
    const data = await page.evaluate(() => {
      const el = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
      const raw = el?.textContent ?? null;
      let scopeKeys: string[] = [];
      let videoListItemCount: number | null = null;
      let userDetailKeys: string[] = [];
      let sample: string | null = null;
      let userMeta: Record<string, unknown> = {};
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const scope = (parsed as { __DEFAULT_SCOPE__?: Record<string, unknown> }).__DEFAULT_SCOPE__ ?? {};
          scopeKeys = Object.keys(scope);
          const videoList = scope["webapp.video-list"] as { itemList?: unknown[] } | undefined;
          videoListItemCount = Array.isArray(videoList?.itemList) ? videoList!.itemList!.length : null;
          const userDetail = scope["webapp.user-detail"] as { userInfo?: { user?: Record<string, unknown>; stats?: Record<string, unknown> }; statusCode?: number; statusMsg?: string } | undefined;
          if (userDetail) {
            userDetailKeys = Object.keys(userDetail);
            const u = userDetail.userInfo?.user;
            userMeta = {
              statusCode: userDetail.statusCode,
              statusMsg: userDetail.statusMsg,
              uniqueId: u?.uniqueId,
              secUid: typeof u?.secUid === "string" ? u.secUid : null,
              privateAccount: u?.privateAccount,
              verified: u?.verified,
              stats: userDetail.userInfo?.stats,
            };
          }
        } catch {
          sample = raw.slice(0, 200);
        }
      }
      return {
        url: location.href,
        title: document.title,
        scriptPresent: !!el,
        scriptLength: raw?.length ?? 0,
        scopeKeys,
        videoListItemCount,
        userDetailKeys,
        userMeta,
        sampleOnParseFail: sample,
      };
    });
    return c.json(data);
  });

  api.get("/socialview/:platform/inspect-dom", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    const page = browser.getPage(platform);
    if (!page) return c.json({ error: `${platform} not running` }, 400);
    const data = await page.evaluate(() => {
      function count(sel: string): number {
        try { return document.querySelectorAll(sel).length; } catch { return -1; }
      }
      function first(sel: string): string {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el ? (el.innerText || el.textContent || "").trim().slice(0, 200) : "";
      }
      const main = document.querySelector("main");
      const dialog = document.querySelector("[role='dialog']");
      const videos = Array.from(document.querySelectorAll("video"));
      const imgs = Array.from(document.querySelectorAll("img")).filter((i) => i.naturalWidth > 200);
      return {
        url: location.href,
        title: document.title,
        counts: {
          article: count("article"),
          main: count("main"),
          dialog: count("[role='dialog']"),
          h1: count("h1"),
          h2: count("h2"),
          video: count("video"),
          imgLarge: imgs.length,
        },
        previews: {
          mainText: main ? (main as HTMLElement).innerText.slice(0, 300) : "",
          dialogText: dialog ? (dialog as HTMLElement).innerText.slice(0, 300) : "",
          h1Text: first("h1"),
        },
        firstVideo: videos[0]?.src || null,
        firstImg: imgs[0]?.src || null,
      };
    });
    return c.json(data);
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
  /**
   * Navigate the platform's browser to `url`, then extract whatever post(s)
   * the resulting page renders. Wraps the existing `goto` + `extract` flow
   * into a single round-trip — primarily for TikTok where bulk profile crawl
   * is blocked by anti-bot and users must extract one video URL at a time
   * from the UI.
   *
   * Body: { url: string, source?: "own" | "role-model", waitMs?: number }
   */
  api.post("/socialview/:platform/extract-url", async (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "invalid platform" }, 400);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        url?: string;
        source?: "own" | "role-model";
        waitMs?: number;
      };
      if (typeof body.url !== "string" || !/^https?:\/\//.test(body.url)) {
        return c.json({ error: "url is required and must be http(s)" }, 400);
      }
      const source = body.source === "own" ? "own" : "role-model";
      const waitMs = Math.min(Math.max(body.waitMs ?? 4_000, 0), 30_000);

      const page = browser.getPage(platform);
      if (!page) return c.json({ error: "platform not running — click Start first" }, 400);

      await browser.gotoUrl(platform, body.url);
      // Let client-side hydration settle. 4s is enough for TikTok video-detail
      // and IG single-post pages in practice; capped at 30s for safety.
      if (waitMs > 0) await page.waitForTimeout(waitMs);

      const result = await extractCurrentPage({ platform, page, source });
      for (const post of result.posts) library.savePost(post);
      return c.json({
        ok: true,
        extracted: result.posts.length,
        postIds: result.posts.map((p) => p.id),
        errors: result.errors,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "extract-url failed" }, 500);
    }
  });

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
    const minLikes = params.minLikes ? Number(params.minLikes) : undefined;
    const postedWithinDays = params.postedWithinDays ? Number(params.postedWithinDays) : undefined;
    const sortBy = params.sortBy === "posted" || params.sortBy === "engagement" || params.sortBy === "extracted"
      ? params.sortBy
      : undefined;
    const tags = params.tags ? params.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const limit = params.limit ? Number(params.limit) : undefined;
    const posts = library.listPosts({
      platform: platform ?? undefined,
      source,
      goldOnly,
      minEngagementRate,
      minLikes,
      postedWithinDays,
      sortBy,
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

  // ─── Watch List ─────────────────────────────────────────────────────
  // Creators (other than Markus) whose posts the auto-crawler harvests
  // regularly into the role-model library. UI lives at the same SocialMediaPage.

  /** List watch-list entries with optional platform / enabledOnly filters. */
  api.get("/socialview/watch-list", (c) => {
    const params = c.req.query();
    const platform = params.platform ? parsePlatform(params.platform) : null;
    if (params.platform && !platform) return c.json({ error: "invalid platform" }, 400);
    const enabledOnly = params.enabledOnly === "true" || params.enabled === "true";
    const entries = watchList.list({ platform: platform ?? undefined, enabledOnly });
    return c.json({ entries });
  });

  /** Add a creator to the watch-list. Rejects duplicates per (platform, handle). */
  api.post("/socialview/watch-list", async (c) => {
    try {
      const body = await c.req.json();
      const platform = parsePlatform(body.platform);
      if (!platform) return c.json({ error: "invalid platform" }, 400);
      if (typeof body.handle !== "string") return c.json({ error: "handle is required" }, 400);
      const result = watchList.create({
        platform,
        handle: body.handle,
        displayName: typeof body.displayName === "string" ? body.displayName : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      });
      if (!result.ok) return c.json({ error: result.error }, result.code as 400 | 409);
      return c.json({ ok: true, entry: result.entry }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "invalid body" }, 400);
    }
  });

  /** Partial update — typically used to pause (enabled=false) or edit notes/displayName. */
  api.patch("/socialview/watch-list/:id", async (c) => {
    try {
      const body = await c.req.json();
      // Whitelist user-editable fields. Crawl-status fields are written only by
      // the crawler internally — accepting them from the API would let the
      // client fabricate a "last crawled" timestamp.
      const patch: watchList.UpdatePatch = {};
      if (typeof body.displayName === "string" || body.displayName === null) {
        patch.displayName = body.displayName ?? undefined;
      }
      if (typeof body.notes === "string" || body.notes === null) {
        patch.notes = body.notes ?? undefined;
      }
      if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
      const updated = watchList.update(c.req.param("id"), patch);
      if (!updated) return c.json({ error: "not found" }, 404);
      return c.json({ ok: true, entry: updated });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "invalid body" }, 400);
    }
  });

  /** Remove a creator from the watch-list. */
  api.delete("/socialview/watch-list/:id", (c) => {
    const ok = watchList.remove(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  /**
   * Manually trigger a full crawl across all enabled watch-list entries.
   * Used for testing the pipeline or kicking it off ahead of the nightly run.
   * Returns the summary so the UI can show how many posts were extracted.
   */
  api.post("/socialview/watch-list/crawl-now", async (c) => {
    const summary = await autoCrawler.crawlOnce();
    return c.json(summary);
  });

  /**
   * Manually trigger a crawl for a single watch-list entry. Useful when
   * adding a new creator and wanting to populate the library immediately.
   */
  api.post("/socialview/watch-list/:id/crawl-now", async (c) => {
    const entry = watchList.get(c.req.param("id"));
    if (!entry) return c.json({ error: "not found" }, 404);
    if (!browser.hasProfile(entry.platform)) {
      return c.json({ error: `${entry.platform} has no login profile — open SocialView and log in once` }, 412);
    }
    // Boot the browser if it's not running so the user doesn't have to do
    // that manually for the manual-trigger path.
    const status = browser.getStatus(entry.platform);
    if (!status.running) {
      try {
        await browser.startPlatform(entry.platform);
      } catch (e) {
        return c.json({ error: `failed to start browser: ${e instanceof Error ? e.message : "unknown"}` }, 500);
      }
    }
    const result = await autoCrawler.crawlEntry(entry);
    return c.json(result);
  });
}
