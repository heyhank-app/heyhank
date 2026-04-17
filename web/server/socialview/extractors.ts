// ─── Post Extractors ─────────────────────────────────────────────────────────
// Per-platform DOM extraction via Playwright. Phase 2 implements Instagram
// first; other platforms throw "not implemented" and will be added once the
// end-to-end flow is validated.

import type { Page } from "playwright";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_ROOT, ensureDirs } from "./library.js";
import { describeImageByUrl } from "./vision.js";
import type { LibraryPost, SocialPlatform } from "./types.js";

export interface ExtractOptions {
  platform: SocialPlatform;
  page: Page;
  source: "own" | "role-model";
  /** Called for side-effects (progress log to UI). */
  onLog?: (msg: string) => void;
}

export interface ExtractResult {
  posts: LibraryPost[];
  errors: string[];
}

/** Detect roughly what type of IG page we're on and run the matching extractor. */
export async function extractCurrentPage(opts: ExtractOptions): Promise<ExtractResult> {
  const url = opts.page.url();

  if (opts.platform === "instagram") {
    if (/\/p\/[^/]+\/?/.test(url) || /\/reel\/[^/]+\/?/.test(url)) {
      return await extractInstagramSinglePost(opts);
    }
    // Profile pages look like https://www.instagram.com/<handle>/
    if (/instagram\.com\/[^/]+\/?$/.test(url) && !/\/(accounts|explore|direct)/.test(url)) {
      return await extractInstagramProfile(opts, 9);
    }
    return { posts: [], errors: [`Instagram URL not recognized for extraction: ${url}`] };
  }

  if (opts.platform === "facebook") {
    // Single-post permalinks: /<handle>/posts/<id>, /permalink.php, /share/p/<id>,
    // /<handle>/videos/<id>, /reel/<id>, /story.php, /watch/?v=<id>
    if (
      /\/posts\//.test(url) ||
      /\/permalink\.php/.test(url) ||
      /\/share\/p\//.test(url) ||
      /\/share\/v\//.test(url) ||
      /\/share\/r\//.test(url) ||
      /\/videos\//.test(url) ||
      /\/reel\//.test(url) ||
      /\/story\.php/.test(url) ||
      /\/watch\//.test(url)
    ) {
      return await extractFacebookSinglePost(opts);
    }
    // Profile / page feed: facebook.com/<handle>  or  facebook.com/profile.php?id=...
    if (
      /facebook\.com\/[^/?#]+\/?$/.test(url) ||
      /facebook\.com\/profile\.php/.test(url) ||
      /facebook\.com\/pages\//.test(url)
    ) {
      return await extractFacebookFeed(opts, 6);
    }
    return { posts: [], errors: [`Facebook URL not recognized for extraction: ${url}`] };
  }

  return { posts: [], errors: [`Extractor not yet implemented for platform: ${opts.platform}`] };
}

/** Extract the single post currently open at /p/<shortcode>/ or /reel/<shortcode>/ */
async function extractInstagramSinglePost(opts: ExtractOptions): Promise<ExtractResult> {
  const { page, source, onLog } = opts;
  try {
    onLog?.("Waiting for post content to render…");
    // Instagram's post pages wrap the article in <article role="presentation">.
    await page.waitForSelector("article", { timeout: 10_000 }).catch(() => {});

    const data = await page.evaluate(() => {
      const article = document.querySelector("article");
      if (!article) return null;

      // Author handle: usually the first <a href="/xyz/"> inside header.
      let handle = "";
      const headerLink = article.querySelector("header a[href^='/']") as HTMLAnchorElement | null;
      if (headerLink) {
        handle = headerLink.getAttribute("href")?.replace(/^\//, "").replace(/\/$/, "") || "";
      }

      // Post text: the caption often lives in <h1> or a <span> in the second part of the article.
      let text = "";
      const h1 = article.querySelector("h1");
      if (h1) text = h1.textContent?.trim() || "";
      if (!text) {
        // Fallback: longest <span> with line breaks
        const spans = Array.from(article.querySelectorAll("span"));
        const rich = spans
          .map((s) => s.textContent?.trim() || "")
          .filter((t) => t.length > 30)
          .sort((a, b) => b.length - a.length);
        if (rich[0]) text = rich[0];
      }

      // Media: all <img> with src starting https:, filter out tiny profile pics
      const imgs = Array.from(article.querySelectorAll("img")) as HTMLImageElement[];
      const mediaUrls = imgs
        .filter((img) => img.naturalWidth > 200 || img.width > 200)
        .map((img) => img.src)
        .filter((src) => src.startsWith("http"));

      // Video sources (reels)
      const videos = Array.from(article.querySelectorAll("video")) as HTMLVideoElement[];
      const videoUrls = videos
        .map((v) => v.src || v.currentSrc)
        .filter((u) => !!u && u.startsWith("http"));

      // Post type heuristic
      let postType = "image";
      if (videoUrls.length > 0) postType = "reel";
      if (mediaUrls.length > 1) postType = "carousel";

      return {
        handle,
        text,
        mediaUrls,
        videoUrls,
        postType,
        url: window.location.href,
      };
    });

    if (!data) {
      return { posts: [], errors: ["Could not find post <article> on page"] };
    }

    // Extract hashtags + mentions from text.
    const hashtags = Array.from(data.text.matchAll(/#(\w+)/g)).map((m) => m[1]);
    const mentions = Array.from(data.text.matchAll(/@(\w+)/g)).map((m) => m[1]);
    const cta = detectCta(data.text);
    const hook = extractHook(data.text);

    // Claude Vision for the first image only (cheap, fast; the rest can be done on-demand).
    let visionDescription = "";
    if (data.mediaUrls.length > 0) {
      onLog?.("Requesting Claude Vision description…");
      visionDescription = await describeImageByUrl(data.mediaUrls[0]);
    }

    const id = `ig-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const post: LibraryPost = {
      id,
      platform: "instagram",
      source,
      url: data.url,
      author: { handle: data.handle },
      text: data.text,
      hook,
      cta,
      hashtags,
      mentions,
      media: [
        ...data.mediaUrls.map((remoteUrl, i) => ({
          type: "image" as const,
          localPath: null,
          remoteUrl,
          description: i === 0 ? visionDescription : "",
        })),
        ...data.videoUrls.map((remoteUrl) => ({
          type: "video" as const,
          localPath: null,
          remoteUrl,
          description: "",
        })),
      ],
      engagement: { likes: null, comments: null, shares: null, views: null, saves: null },
      engagementRate: null,
      postType: data.postType as LibraryPost["postType"],
      postedAt: null,
      tags: [],
      isGold: false,
      extractedAt: new Date().toISOString(),
      notes: "",
    };

    return { posts: [post], errors: [] };
  } catch (e) {
    return {
      posts: [],
      errors: [`Extraction failed: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

/** From a profile page, open the first N posts and extract each. */
async function extractInstagramProfile(
  opts: ExtractOptions,
  maxPosts: number,
): Promise<ExtractResult> {
  const { page, onLog } = opts;
  const posts: LibraryPost[] = [];
  const errors: string[] = [];

  try {
    await page.waitForSelector("main a[href*='/p/'], main a[href*='/reel/']", { timeout: 10_000 });

    const links = await page.evaluate((max) => {
      const anchors = Array.from(document.querySelectorAll("main a")) as HTMLAnchorElement[];
      const hrefs = anchors
        .map((a) => a.getAttribute("href") || "")
        .filter((h) => /\/p\/[^/]+\/?$/.test(h) || /\/reel\/[^/]+\/?$/.test(h));
      return Array.from(new Set(hrefs)).slice(0, max);
    }, maxPosts);

    onLog?.(`Found ${links.length} posts on profile — extracting…`);

    for (const href of links) {
      try {
        const absoluteUrl = new URL(href, "https://www.instagram.com").toString();
        await page.goto(absoluteUrl, { waitUntil: "domcontentloaded" });
        const single = await extractInstagramSinglePost(opts);
        posts.push(...single.posts);
        errors.push(...single.errors);
      } catch (e) {
        errors.push(`Failed on ${href}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    errors.push(`Profile scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { posts, errors };
}

// ─── Facebook ───────────────────────────────────────────────────────────────
// Facebook's DOM is extremely dynamic: class names are obfuscated and rotate
// every few weeks. The strategy is to lean on structural roles (role="article"),
// stable aria-labels, and heuristic scoring of candidate text/image nodes rather
// than brittle class selectors. The extractor expands "See more" if present so
// the caption is captured in full.

async function extractFacebookSinglePost(opts: ExtractOptions): Promise<ExtractResult> {
  const { page, source, onLog } = opts;
  try {
    onLog?.("Waiting for Facebook post to render…");
    // FB lazy-loads stories. Wait for any article-role container.
    await page
      .waitForSelector("div[role='article'], [data-pagelet*='FeedUnit']", {
        state: "attached",
        timeout: 10_000,
      })
      .catch(() => {});

    // Expand "See more" / "Mehr anzeigen" so we capture full text.
    await expandFacebookSeeMore(page).catch(() => {});

    const data = await page.evaluate(() => {
      // Prefer the outermost article that contains a permalink or timestamp.
      const articles = Array.from(
        document.querySelectorAll("div[role='article']"),
      ) as HTMLElement[];
      const article = articles.find((a) => a.querySelector("a[href*='/posts/'], a[href*='/videos/'], a[href*='/permalink'], a[href*='/share/']"))
        || articles[0]
        || document.body;

      // Author handle: first link inside article pointing to a profile
      // (href starts with "/" and isn't a media or reaction link).
      let handle = "";
      let displayName = "";
      const authorLinks = Array.from(article.querySelectorAll("a[href^='/']")) as HTMLAnchorElement[];
      for (const a of authorLinks) {
        const href = a.getAttribute("href") || "";
        if (/^\/(photo|video|reel|share|hashtag|stories|groups|events|marketplace|watch)/.test(href))
          continue;
        if (/\/(posts|permalink|comments)/.test(href)) continue;
        // Normalize: /<handle>/ or /<handle>?
        const m = href.match(/^\/([^/?#]+)/);
        if (!m) continue;
        const text = (a.textContent || "").trim();
        if (!text || text.length > 80) continue;
        handle = m[1];
        displayName = text;
        break;
      }

      // Post text: FB wraps the caption in a container marked via data-ad-comet-preview
      // or data-ad-preview="message". Fallback: longest text block inside article that
      // isn't an author name or reaction count.
      let text = "";
      const msgNode = article.querySelector(
        "[data-ad-comet-preview='message'], [data-ad-preview='message'], [data-testid='post_message']",
      );
      if (msgNode) text = (msgNode.textContent || "").trim();
      if (!text) {
        // Fallback: look at direct divs with dir="auto" that are longer than 40 chars.
        const candidates = Array.from(article.querySelectorAll("div[dir='auto']"))
          .map((d) => (d.textContent || "").trim())
          .filter((t) => t.length > 40 && !/^[\d.,KM\s]+$/.test(t));
        // Sort by length desc and pick the longest.
        candidates.sort((a, b) => b.length - a.length);
        if (candidates[0]) text = candidates[0];
      }

      // Media: images larger than 200px, exclude the tiny author avatar.
      const imgs = Array.from(article.querySelectorAll("img")) as HTMLImageElement[];
      const mediaUrls = imgs
        .filter((img) => (img.naturalWidth || img.width) > 200)
        .map((img) => img.src)
        .filter((src) => src.startsWith("http"));

      // Videos — Facebook uses <video> elements for reels and video posts.
      const videos = Array.from(article.querySelectorAll("video")) as HTMLVideoElement[];
      const videoUrls = videos
        .map((v) => v.src || v.currentSrc)
        .filter((u) => !!u && u.startsWith("http"));

      // Timestamp: the permalink anchor often has an aria-label with the date.
      let postedAt: string | null = null;
      const timeLink = article.querySelector(
        "a[href*='/posts/'] span[aria-label], a[href*='/permalink'] span[aria-label], a[href*='/videos/'] span[aria-label]",
      );
      if (timeLink) {
        const label = timeLink.getAttribute("aria-label") || "";
        if (label) postedAt = label;
      }

      // Engagement: FB hides exact numbers behind aria-labels.
      // "X reactions" / "Y comments" / "Z shares".
      const parseCount = (s: string | null): number | null => {
        if (!s) return null;
        const m = s.match(/([\d.,]+)\s*(k|m|tsd|mio|million|thousand)?/i);
        if (!m) return null;
        let n = parseFloat(m[1].replace(/[.,]/g, (c) => (c === "," ? "." : "")));
        if (!Number.isFinite(n)) return null;
        const unit = (m[2] || "").toLowerCase();
        if (unit.startsWith("k") || unit.startsWith("tsd")) n *= 1_000;
        if (unit.startsWith("m") || unit.startsWith("mio") || unit === "million") n *= 1_000_000;
        return Math.round(n);
      };
      let likes: number | null = null;
      let comments: number | null = null;
      let shares: number | null = null;
      const reactionNode = article.querySelector(
        "[aria-label*='reaction'], [aria-label*='Reaktion'], [aria-label*='Gefällt']",
      );
      if (reactionNode) likes = parseCount(reactionNode.getAttribute("aria-label"));
      const commentNode = article.querySelector(
        "[aria-label*='comment'], [aria-label*='Kommentar']",
      );
      if (commentNode) comments = parseCount(commentNode.getAttribute("aria-label"));
      const shareNode = article.querySelector(
        "[aria-label*='share'], [aria-label*='Teilen'], [aria-label*='geteilt']",
      );
      if (shareNode) shares = parseCount(shareNode.getAttribute("aria-label"));

      // Post type
      let postType = "text";
      if (videoUrls.length > 0) {
        postType = /\/reel\//.test(window.location.href) ? "reel" : "video";
      } else if (mediaUrls.length > 1) {
        postType = "carousel";
      } else if (mediaUrls.length === 1) {
        postType = "image";
      }

      return {
        handle,
        displayName,
        text,
        mediaUrls,
        videoUrls,
        postType,
        postedAt,
        likes,
        comments,
        shares,
        url: window.location.href,
      };
    });

    if (!data) {
      return { posts: [], errors: ["Could not find Facebook article on page"] };
    }
    if (!data.text && data.mediaUrls.length === 0 && data.videoUrls.length === 0) {
      return {
        posts: [],
        errors: ["Facebook post appears empty (no text/media found) — DOM may have changed"],
      };
    }

    const hashtags = Array.from(data.text.matchAll(/#(\w+)/g)).map((m) => m[1]);
    const mentions = Array.from(data.text.matchAll(/@(\w+)/g)).map((m) => m[1]);
    const cta = detectCta(data.text);
    const hook = extractHook(data.text);

    let visionDescription = "";
    if (data.mediaUrls.length > 0) {
      onLog?.("Requesting Claude Vision description…");
      visionDescription = await describeImageByUrl(data.mediaUrls[0]);
    }

    const id = `fb-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const post: LibraryPost = {
      id,
      platform: "facebook",
      source,
      url: data.url,
      author: {
        handle: data.handle,
        displayName: data.displayName || undefined,
      },
      text: data.text,
      hook,
      cta,
      hashtags,
      mentions,
      media: [
        ...data.mediaUrls.map((remoteUrl, i) => ({
          type: "image" as const,
          localPath: null,
          remoteUrl,
          description: i === 0 ? visionDescription : "",
        })),
        ...data.videoUrls.map((remoteUrl) => ({
          type: "video" as const,
          localPath: null,
          remoteUrl,
          description: "",
        })),
      ],
      engagement: {
        likes: data.likes,
        comments: data.comments,
        shares: data.shares,
        views: null,
        saves: null,
      },
      engagementRate: null,
      postType: data.postType as LibraryPost["postType"],
      postedAt: data.postedAt,
      tags: [],
      isGold: false,
      extractedAt: new Date().toISOString(),
      notes: "",
    };

    return { posts: [post], errors: [] };
  } catch (e) {
    return {
      posts: [],
      errors: [`Facebook extraction failed: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

/** From a profile/page feed, collect the first N post permalinks and extract each. */
async function extractFacebookFeed(
  opts: ExtractOptions,
  maxPosts: number,
): Promise<ExtractResult> {
  const { page, onLog } = opts;
  const posts: LibraryPost[] = [];
  const errors: string[] = [];

  try {
    // FB virtualizes the feed — articles exist in the DOM but may not be
    // "visible" per Playwright's default check. Wait for attachment only.
    await page.waitForSelector("div[role='article']", {
      state: "attached",
      timeout: 10_000,
    });
    // Scroll to load more articles into the virtualized feed.
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(1500);

    const links = await page.evaluate((max) => {
      const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];

      // Extract a stable post identifier so the same post appearing in multiple
      // places (notification, feed, comment thread) dedupes to one entry.
      const postIdOf = (href: string): string | null => {
        let m = href.match(/\/posts\/(pfbid[A-Za-z0-9]+|\d+)/);
        if (m) return `post:${m[1]}`;
        m = href.match(/\/videos\/(\d+)/);
        if (m) return `video:${m[1]}`;
        m = href.match(/\/reel\/(\d+)/);
        if (m) return `reel:${m[1]}`;
        m = href.match(/\/share\/(p|v|r)\/([A-Za-z0-9]+)/);
        if (m) return `share:${m[2]}`;
        m = href.match(/story_fbid=(\d+)/);
        if (m) return `story:${m[1]}`;
        return null;
      };

      // Strip noisy URL params (notif tracking, CFT tokens) so page.goto lands
      // cleanly on the post itself instead of a notification-style fallback view.
      const cleanUrl = (href: string): string => {
        try {
          const u = new URL(href, "https://www.facebook.com");
          // Keep only params that identify the post or media.
          const keep = new Set(["story_fbid", "id", "v", "fbid"]);
          const kept: [string, string][] = [];
          for (const [k, v] of u.searchParams) {
            if (keep.has(k)) kept.push([k, v]);
          }
          u.search = "";
          for (const [k, v] of kept) u.searchParams.set(k, v);
          u.hash = "";
          return u.toString();
        } catch {
          return href;
        }
      };

      const byId = new Map<string, string>();
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        if (!href) continue;
        // Reject notification / notif-dropdown links outright — they aren't real
        // post permalinks on this profile and goto()ing them breaks the context.
        if (/[?&](notif_id|notif_t|ref=notif|comment_id)\b/.test(href)) continue;
        const isPost =
          /\/posts\/[^/?#]+/.test(href) ||
          /\/permalink\.php/.test(href) ||
          /\/videos\/[^/?#]+/.test(href) ||
          /\/reel\/[^/?#]+/.test(href) ||
          /\/share\/(p|v|r)\//.test(href) ||
          /\/story\.php/.test(href);
        if (!isPost) continue;
        const id = postIdOf(href);
        if (!id) continue;
        if (byId.has(id)) continue;
        const abs = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
        byId.set(id, cleanUrl(abs));
        if (byId.size >= max) break;
      }
      return Array.from(byId.values());
    }, maxPosts);

    onLog?.(`Found ${links.length} posts on feed — extracting…`);

    for (const href of links) {
      try {
        if (page.isClosed()) {
          errors.push("Browser page was closed during extraction — aborting feed scan");
          break;
        }
        await page.goto(href, { waitUntil: "domcontentloaded", timeout: 15_000 });
        await page.waitForTimeout(800);
        const single = await extractFacebookSinglePost(opts);
        posts.push(...single.posts);
        errors.push(...single.errors);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Failed on ${href}: ${msg}`);
        // If the context is gone there's no point continuing.
        if (/page.*closed|context.*closed|browser.*closed|Target closed/i.test(msg)) {
          errors.push("Aborting remaining extractions (browser context lost)");
          break;
        }
      }
    }
  } catch (e) {
    errors.push(`Facebook feed scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { posts, errors };
}

/** Click any "See more" / "Mehr anzeigen" toggle inside article to expand truncated text. */
async function expandFacebookSeeMore(page: Page): Promise<void> {
  await page.evaluate(() => {
    const article = document.querySelector("div[role='article']");
    if (!article) return;
    const candidates = Array.from(article.querySelectorAll("div[role='button'], span")) as HTMLElement[];
    for (const el of candidates) {
      const t = (el.textContent || "").trim().toLowerCase();
      if (t === "see more" || t === "mehr anzeigen" || t === "weiterlesen" || t === "...mehr") {
        el.click();
        return;
      }
    }
  });
  await page.waitForTimeout(400);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractHook(text: string): string {
  const trimmed = text.trim();
  // First sentence up to 140 chars, or first 2 lines, whichever shorter.
  const firstLineBreak = trimmed.indexOf("\n");
  const firstLine = firstLineBreak > 0 ? trimmed.slice(0, firstLineBreak) : trimmed;
  const firstSentenceMatch = firstLine.match(/^(.+?[.!?])\s/);
  const candidate = firstSentenceMatch ? firstSentenceMatch[1] : firstLine;
  return candidate.slice(0, 140).trim();
}

/** Very simple CTA detection: questions, imperatives, "link in bio" phrases. */
function detectCta(text: string): string | null {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  // Check from the end — CTAs are usually at the bottom.
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
    const line = lines[i];
    if (!line) continue;
    if (/\?$/.test(line)) return line; // question
    if (/link in bio|link in der bio|tap the link|mehr im link|swipe up/i.test(line)) return line;
    if (/^(kommentiere|schreib|teile|kommentier|tag|follow|folg|speicher)/i.test(line)) return line;
  }
  return null;
}

// Media download helper — optional future use (currently vision is URL-based).
// Keeping stub available as we'll want local copies for offline training.
export async function downloadImage(
  _url: string,
  _postId: string,
  _index: number,
): Promise<string | null> {
  ensureDirs();
  try {
    const res = await fetch(_url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = guessExt(res.headers.get("content-type"));
    const filename = `${_postId}-${_index}.${ext}`;
    const path = join(MEDIA_ROOT, filename);
    writeFileSync(path, buf);
    return path;
  } catch {
    return null;
  }
}

function guessExt(ct: string | null): string {
  if (!ct) return "bin";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("mp4")) return "mp4";
  return "bin";
}
