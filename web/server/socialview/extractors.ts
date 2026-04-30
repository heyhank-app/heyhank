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
  opts.onLog?.(`URL: ${url}`);

  if (opts.platform === "instagram") {
    if (/\/p\/[^/]+\/?/.test(url) || /\/reel\/[^/]+\/?/.test(url)) {
      opts.onLog?.("Detected: Instagram single post");
      return await extractInstagramSinglePost(opts);
    }
    // Profile pages look like https://www.instagram.com/<handle>/
    if (/instagram\.com\/[^/]+\/?$/.test(url) && !/\/(accounts|explore|direct)/.test(url)) {
      opts.onLog?.("Detected: Instagram profile (up to 9 posts)");
      return await extractInstagramProfile(opts, 25);
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
      opts.onLog?.("Detected: Facebook single post");
      return await extractFacebookSinglePost(opts);
    }
    // Profile / page feed: facebook.com/<handle>  or  facebook.com/profile.php?id=...
    // Desktop FB 2026 moved post wrappers OFF `role='article'` (which is now
    // used for comments + side widgets). Posts live under elements carrying
    // `[data-ad-rendering-role='story_message']` / `[data-ad-comet-preview='message']`
    // for the body and `[data-ad-rendering-role='profile_name']` for the author
    // header. mbasic.facebook.com redirects to www in 2026 so the mobile path
    // is dead. We anchor on the message nodes and walk up to find each post
    // wrapper.
    if (
      /facebook\.com\/[^/?#]+\/?$/.test(url) ||
      /facebook\.com\/profile\.php/.test(url) ||
      /facebook\.com\/pages\//.test(url)
    ) {
      opts.onLog?.("Detected: Facebook profile feed — desktop message-anchor extractor");
      return await extractFacebookFeedDesktop(opts, 25);
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

    // Scroll to populate more thumbnails — IG lazy-loads the grid as you scroll.
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(700);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);

    const links = await page.evaluate((max) => {
      const anchors = Array.from(document.querySelectorAll("main a")) as HTMLAnchorElement[];
      const hrefs = anchors
        .map((a) => a.getAttribute("href") || "")
        .filter((h) => /\/p\/[^/]+\/?$/.test(h) || /\/reel\/[^/]+\/?$/.test(h));
      return Array.from(new Set(hrefs)).slice(0, max);
    }, maxPosts);

    onLog?.(`Found ${links.length} posts on profile — extracting…`);

    let idx = 0;
    for (const href of links) {
      idx++;
      try {
        const absoluteUrl = new URL(href, "https://www.instagram.com").toString();
        onLog?.(`${idx}/${links.length}: ${absoluteUrl}`);
        await page.goto(absoluteUrl, { waitUntil: "domcontentloaded" });
        const single = await extractInstagramSinglePost(opts);
        posts.push(...single.posts);
        errors.push(...single.errors);
        if (single.posts.length > 0) {
          onLog?.(`${idx}/${links.length}: ✓ saved "${(single.posts[0].text || "").slice(0, 60)}"`);
        } else {
          onLog?.(`${idx}/${links.length}: ✗ no post extracted`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Failed on ${href}: ${msg}`);
        onLog?.(`${idx}/${links.length}: ✗ ${msg}`);
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

// ─── Facebook profile feed — desktop (2026 layout) ─────────────────────────
// Posts on desktop FB 2026 are NOT wrapped in `role='article'` at top level
// (those are comments + side widgets). The reliable anchors are:
//   - [data-ad-comet-preview='message']  — post body container
//   - [data-ad-preview='message']        — same body, dual-attributed
//   - [data-ad-rendering-role='story_message']  — message wrapper
//   - [data-ad-rendering-role='profile_name']   — author header
//   - [data-ad-rendering-role='like_button' | 'comment_button' | 'share_button']
// Strategy: collect every message anchor in the DOM, walk up to the closest
// ancestor that ALSO contains a profile_name AND a like_button — that's the
// post wrapper. Dedupe wrappers (we drop wrappers that contain other wrappers
// to keep only the inner-most one per post).
async function extractFacebookFeedDesktop(
  opts: ExtractOptions,
  maxPosts: number,
): Promise<ExtractResult> {
  const { page, source, onLog } = opts;
  const posts: LibraryPost[] = [];
  const errors: string[] = [];

  try {
    // Wait for at least one message marker to be in the DOM. These appear
    // once FB has hydrated the first post tile.
    await page
      .waitForSelector(
        "[data-ad-comet-preview='message'], [data-ad-preview='message'], [data-ad-rendering-role='story_message']",
        { state: "attached", timeout: 12_000 },
      )
      .catch(() => {});

    // Scroll to populate more posts (FB virtualises the feed).
    for (let i = 0; i < 18; i++) {
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(900);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);

    // Click any "See more" / "Mehr anzeigen" toggles page-wide so captions
    // aren't truncated. The button is sometimes a sibling of the message
    // container, not a descendant — so we search the whole document. Repeat
    // a few times because expanded text may itself contain another toggle
    // (long posts get folded twice).
    for (let pass = 0; pass < 3; pass++) {
      const clicked = await page.evaluate(() => {
        const isToggle = (s: string) => {
          const t = s.trim().toLowerCase();
          return (
            t === "see more" ||
            t === "mehr anzeigen" ||
            t === "weiterlesen" ||
            t === "...mehr" ||
            t === "… mehr" ||
            t === "show more"
          );
        };
        const candidates = Array.from(
          document.querySelectorAll("div[role='button'], span[role='button'], span"),
        ) as HTMLElement[];
        let count = 0;
        for (const el of candidates) {
          if (!el.isConnected) continue;
          // The toggle is usually a leaf — skip elements whose textContent
          // contains the trigger as part of a longer string (e.g. message
          // body that ends with "… Mehr anzeigen"). Compare to direct text.
          const direct = (el.textContent || "").trim();
          if (direct.length > 30) continue;
          if (!isToggle(direct)) continue;
          try { el.click(); count++; } catch { /* noop */ }
        }
        return count;
      }).catch(() => 0);
      if (!clicked) break;
      await page.waitForTimeout(700);
    }

    const currentUrl = page.url();
    const handleMatch = currentUrl.match(/facebook\.com\/([^/?#]+)/);
    const expectedHandle =
      handleMatch &&
      !/^(profile\.php|pages|watch|story\.php|groups|marketplace|events)$/.test(handleMatch[1])
        ? handleMatch[1].toLowerCase()
        : null;
    if (expectedHandle) onLog?.(`Expected handle: ${expectedHandle}`);

    const raw = await page.evaluate(({ max, expectedHandle }) => {
      const parseCount = (s: string | null): number | null => {
        if (!s) return null;
        const mm = s.match(/([\d.,]+)\s*(k|m|tsd|mio|million|thousand)?/i);
        if (!mm) return null;
        let n = parseFloat(mm[1].replace(/[.,]/g, (c) => (c === "," ? "." : "")));
        if (!Number.isFinite(n)) return null;
        const unit = (mm[2] || "").toLowerCase();
        if (unit.startsWith("k") || unit.startsWith("tsd")) n *= 1_000;
        if (unit.startsWith("m") || unit.startsWith("mio") || unit === "million") n *= 1_000_000;
        return Math.round(n);
      };

      const extractHandleFromHref = (href: string): string | null => {
        if (/comment_id=/.test(href)) return null;
        const profIdMatch = href.match(/profile\.php\?id=(\d+)/);
        if (profIdMatch) return profIdMatch[1];
        // Strip protocol+host first so we always match against the path.
        let path = href;
        const httpMatch = href.match(/^https?:\/\/[^/]+(\/.*)$/);
        if (httpMatch) path = httpMatch[1];
        const slugMatch = path.match(/^\/([^/?#]+)/);
        if (!slugMatch) return null;
        const slug = slugMatch[1];
        if (
          /^(photo|video|reel|share|hashtag|stories|groups|events|marketplace|watch|posts|permalink|comments|browse|story\.php|home\.php|notifications|profile\.php|p|reels)$/i.test(
            slug,
          )
        ) {
          return null;
        }
        return slug;
      };

      // 1) Collect all message anchors in document order.
      const messageNodes = Array.from(
        document.querySelectorAll(
          "[data-ad-comet-preview='message'], [data-ad-preview='message'], [data-ad-rendering-role='story_message']",
        ),
      ) as HTMLElement[];

      // 2) For each message, walk up to find the closest ancestor that also
      //    contains a profile_name AND a like_button. That's the post wrapper.
      const wrapperSet = new Set<HTMLElement>();
      const messageByWrapper = new Map<HTMLElement, HTMLElement>();
      // A wrapper is the smallest ancestor of a message-anchor that
      // contains profile_name + like_button + a post-permalink anchor
      // (timestamp link). The permalink requirement is what stops us from
      // picking a too-narrow wrapper that excludes the header.
      const hasPermalinkAnchor = (el: HTMLElement): boolean => {
        for (const a of Array.from(el.querySelectorAll("a[href]")) as HTMLAnchorElement[]) {
          const h = a.getAttribute("href") || "";
          if (/comment_id=/.test(h)) continue;
          if (/\/(posts|videos|reel|permalink|share\/p|share\/r|share\/v)\//.test(h)) return true;
          if (/\/(photo|photos)(\/|\?fbid=)/.test(h)) return true;
        }
        return false;
      };
      for (const msg of messageNodes) {
        let cur: HTMLElement | null = msg;
        for (let depth = 0; depth < 25 && cur; depth++) {
          cur = cur.parentElement;
          if (!cur) break;
          const hasProfile = !!cur.querySelector("[data-ad-rendering-role='profile_name']");
          const hasLike = !!cur.querySelector("[data-ad-rendering-role='like_button']");
          if (hasProfile && hasLike && hasPermalinkAnchor(cur)) {
            // Prefer inner-most wrapper: drop any already-collected wrapper
            // that contains this one, and skip if a smaller wrapper already
            // exists inside this one.
            let isContainedByExisting = false;
            for (const w of Array.from(wrapperSet)) {
              if (w !== cur && w.contains(cur)) {
                wrapperSet.delete(w);
                messageByWrapper.delete(w);
              } else if (w !== cur && cur.contains(w)) {
                isContainedByExisting = true;
              }
            }
            if (!isContainedByExisting && !wrapperSet.has(cur)) {
              wrapperSet.add(cur);
              messageByWrapper.set(cur, msg);
            }
            break;
          }
        }
      }
      const wrappers = Array.from(wrapperSet);

      // 2.5) Detect the actual profile owner. FB does NOT necessarily use the
      //      URL slug (vanity) as the handle in author hrefs — a profile
      //      reachable via /aitrendz.xyz1 might be linked internally as
      //      /profile.php?id=NNN, /someother.slug, or display "René Remsik".
      //      So: collect the (handle, displayName) of every wrapper's
      //      profile_name link, count frequencies, and treat the dominant
      //      one as the page owner.
      const wrapperMeta = wrappers.map((wrap) => {
        const profile = wrap.querySelector("[data-ad-rendering-role='profile_name']") as HTMLElement | null;
        let h = "";
        let dn = "";
        if (profile) {
          const links = Array.from(profile.querySelectorAll("a[href]")) as HTMLAnchorElement[];
          for (const a of links) {
            const slug = extractHandleFromHref(a.getAttribute("href") || "");
            if (!slug) continue;
            const t = (a.textContent || "").trim();
            if (!t || t.length > 80) continue;
            h = slug;
            dn = t;
            break;
          }
        }
        // Find permalink owner. Search ONLY within the wrapper itself —
        // walking ancestors picks up links from sibling posts (especially
        // the shared /stories/ links FB uses for the feed-virtualization
        // container) which would assign the same wrong permalink to multiple
        // posts.
        let permalinkOwner: string | null = null;
        let permalink: string | null = null;
        const allHrefs: string[] = [];
        for (const a of Array.from(wrap.querySelectorAll("a[href]")) as HTMLAnchorElement[]) {
          const href = a.getAttribute("href") || "";
          if (allHrefs.length < 12) allHrefs.push(href.slice(0, 200));
          if (/comment_id=/.test(href)) continue;
          const ownerMatch =
            href.match(/^\/([^/?#]+)\/(?:posts|videos|reel)\//) ||
            href.match(/facebook\.com\/([^/?#]+)\/(?:posts|videos|reel)\//);
          if (ownerMatch) {
            permalinkOwner = ownerMatch[1].toLowerCase();
            permalink = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
            break;
          }
          if (/\/(permalink|share\/p|share\/r|share\/v)\//.test(href) && !permalink) {
            permalink = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
          }
          if (/\/(photo|photos)(\/|\?fbid=)/.test(href) && !permalink) {
            permalink = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
          }
        }
        return { wrap, handle: h, displayName: dn, permalinkOwner, permalink, debugHrefs: allHrefs };
      });

      // Tally handle frequency. Most-frequent wins as page owner — but only
      // if it dominates (≥ 30% of wrappers AND ≥ 2 occurrences). Otherwise
      // we treat the page as a heterogeneous feed (recommendations etc.) and
      // fall back to the URL-slug filter.
      const handleCounts = new Map<string, { count: number; displayName: string }>();
      for (const w of wrapperMeta) {
        if (!w.handle) continue;
        const key = w.handle.toLowerCase();
        const ex = handleCounts.get(key);
        if (ex) ex.count++;
        else handleCounts.set(key, { count: 1, displayName: w.displayName });
      }
      const ownerCounts = Array.from(handleCounts.entries()).sort((a, b) => b[1].count - a[1].count);
      const dominant = ownerCounts[0];
      let detectedOwner: string | null = null;
      let detectedOwnerName = "";
      if (dominant && dominant[1].count >= 2 && dominant[1].count / wrappers.length >= 0.3) {
        detectedOwner = dominant[0];
        detectedOwnerName = dominant[1].displayName;
      }

      // The "effective owner" used for filtering: detected owner if we have
      // one, else the URL-slug expectedHandle.
      const effectiveOwner = detectedOwner || (expectedHandle ? expectedHandle.toLowerCase() : null);

      const results: Array<{
        handle: string;
        displayName: string;
        text: string;
        mediaUrls: string[];
        videoUrls: string[];
        postType: string;
        postedAt: string | null;
        likes: number | null;
        comments: number | null;
        shares: number | null;
        permalink: string | null;
      }> = [];
      let skippedWrongHandle = 0;
      let skippedEmpty = 0;
      const seenSig = new Set<string>();

      let skippedPinned = 0;
      for (const meta of wrapperMeta) {
        if (results.length >= max) break;
        const wrap = meta.wrap;
        let handle = meta.handle;
        let displayName = meta.displayName;
        const permalink = meta.permalink;
        const permalinkOwner = meta.permalinkOwner;

        // Skip pinned posts. FB shows them at the top of profile feeds and
        // they can be months/years old. Look for the pin marker near the
        // header — usually a sibling of profile_name with text "Angeheftet"
        // / "Pinned post" / "Featured", or an aria-label hinting at it.
        const profileEl = wrap.querySelector("[data-ad-rendering-role='profile_name']") as HTMLElement | null;
        let isPinned = false;
        if (profileEl) {
          const headerArea = profileEl.parentElement || profileEl;
          const headerText = (headerArea.innerText || "").toLowerCase();
          if (
            /^(angeheftet|pinned post|pinned|angeheftete? beitr|featured)$/m.test(headerText) ||
            /\b(angeheftet|pinned post|pinned|angepinnt|featured post)\b/.test(headerText.split("\n")[0] || "")
          ) {
            isPinned = true;
          }
          // Also check for the explicit aria-label/title on the pin icon.
          if (
            headerArea.querySelector(
              "[aria-label*='Angeheftet' i], [aria-label*='Pinned' i], [aria-label*='angepinnt' i]",
            )
          ) {
            isPinned = true;
          }
        }
        if (isPinned) {
          skippedPinned++;
          continue;
        }

        // Filter: keep wrapper only if it belongs to the effective owner.
        // Match either by author handle or by permalink path-owner.
        if (effectiveOwner) {
          const ownerMatchByPermalink = permalinkOwner && permalinkOwner === effectiveOwner;
          const ownerMatchByHandle = handle && handle.toLowerCase() === effectiveOwner;
          const haveOwnerInfo = !!permalinkOwner || !!handle;
          if (haveOwnerInfo && !ownerMatchByPermalink && !ownerMatchByHandle) {
            skippedWrongHandle++;
            continue;
          }
          // If matched by permalink but no handle was detected, fill in.
          if (ownerMatchByPermalink && !handle) {
            handle = effectiveOwner;
            if (!displayName && detectedOwnerName) displayName = detectedOwnerName;
          }
        }

        // Body text from the message node we tagged onto this wrapper.
        // Use innerText (NOT textContent) so we get only the visually rendered
        // characters. FB injects hidden <span style="display:none"> decoys
        // with random characters between the real ones as an anti-scraping
        // measure — textContent reads them all and produces gibberish like
        // "oeSrnodstp 0 809a"; innerText respects CSS visibility and yields
        // the clean rendered text.
        const msgNode = messageByWrapper.get(wrap);
        let text = "";
        if (msgNode) text = (msgNode.innerText || "").trim();

        // Note: own-comments are fetched in a SECOND pass via permalink tabs
        // — see fetchOwnCommentsFromPermalink below. Inline expansion via
        // clicking comment_button on the feed view proved unreliable: FB
        // doesn't always load the full thread inline, and "Verfasser"-tagged
        // own-comments often only render on the post's permalink page.

        // Posted-at: prefer aria-label of timestamp link.
        let postedAt: string | null = null;
        const tsNode = wrap.querySelector(
          "a[href*='/posts/'] [aria-label], a[href*='/permalink'] [aria-label], a[href*='/videos/'] [aria-label], a[href*='/reel/'] [aria-label]",
        );
        if (tsNode) {
          const lab = tsNode.getAttribute("aria-label") || "";
          if (lab) postedAt = lab;
        }

        // Engagement.
        let likes: number | null = null;
        let comments: number | null = null;
        let shares: number | null = null;
        const reactionNode = wrap.querySelector(
          "[aria-label*='Gefällt mir: '], [aria-label*='reactions'], [aria-label*='Reaktion']",
        );
        if (reactionNode) likes = parseCount(reactionNode.getAttribute("aria-label"));
        // Fallback: number adjacent to like_button.
        if (likes == null) {
          const likeBtn = wrap.querySelector("[data-ad-rendering-role='like_button']");
          if (likeBtn) {
            const sib = likeBtn.parentElement?.textContent?.trim() || "";
            likes = parseCount(sib);
          }
        }
        const commentBtn = wrap.querySelector("[data-ad-rendering-role='comment_button']");
        if (commentBtn) {
          // The visible count usually sits as text inside the button or as an
          // aria-label like "3 Kommentare".
          const lab = commentBtn.getAttribute("aria-label");
          if (lab) comments = parseCount(lab);
          if (comments == null) {
            const t = (commentBtn.textContent || "").trim();
            comments = parseCount(t);
          }
        }
        const shareBtn = wrap.querySelector("[data-ad-rendering-role='share_button']");
        if (shareBtn) {
          const lab = shareBtn.getAttribute("aria-label");
          if (lab) shares = parseCount(lab);
          if (shares == null) {
            const t = (shareBtn.textContent || "").trim();
            shares = parseCount(t);
          }
        }

        // Media: images >200px inside the wrapper, excluding profile photos
        // (which usually live inside [data-ad-rendering-role='profile_name'])
        // and emoji/safe_image hosts.
        const wrapClone = wrap.cloneNode(true) as HTMLElement;
        for (const p of Array.from(wrapClone.querySelectorAll("[data-ad-rendering-role='profile_name']"))) {
          p.remove();
        }
        const imgs = Array.from(wrapClone.querySelectorAll("img")) as HTMLImageElement[];
        const mediaUrls = imgs
          .filter((img) => (img.naturalWidth || img.width) > 200)
          .map((img) => img.src)
          .filter((src) => src.startsWith("http") && !/emoji|safe_image\.php/i.test(src));
        const videos = Array.from(wrapClone.querySelectorAll("video")) as HTMLVideoElement[];
        const videoUrls = videos
          .map((v) => v.src || v.currentSrc)
          .filter((u) => !!u && u.startsWith("http"));

        if (!text && mediaUrls.length === 0 && videoUrls.length === 0) {
          skippedEmpty++;
          continue;
        }

        // Dedupe by text+first-image signature.
        const sig = (text.slice(0, 120) + "|" + (mediaUrls[0] || "") + "|" + (permalink || "")).trim();
        if (sig && seenSig.has(sig)) continue;
        if (sig) seenSig.add(sig);

        let postType = "text";
        if (videoUrls.length > 0) postType = "video";
        else if (mediaUrls.length > 1) postType = "carousel";
        else if (mediaUrls.length === 1) postType = "image";

        results.push({
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
          permalink,
        });
      }

      // Per-wrapper diagnostic list so we can see WHAT was found, not just
      // counts. Helps when a profile uses a non-obvious handle (e.g. URL slug
      // ≠ author handle, vanity URLs, numeric profile IDs).
      const wrapperDiag = wrapperMeta.map((w) => ({
        handle: w.handle,
        displayName: w.displayName,
        permalinkOwner: w.permalinkOwner,
        permalink: w.permalink,
        debugHrefs: w.debugHrefs as string[],
      }));

      return {
        items: results,
        diag: {
          messageNodes: messageNodes.length,
          wrappers: wrappers.length,
          skippedWrongHandle,
          skippedEmpty,
          skippedPinned,
          detectedOwner,
          detectedOwnerName,
          effectiveOwner,
          ownerCounts: ownerCounts.slice(0, 5).map(([h, v]) => ({ handle: h, count: v.count, displayName: v.displayName })),
          wrapperDiag,
        },
      };
    }, { max: maxPosts, expectedHandle });

    onLog?.(
      `Scan: ${raw.diag.messageNodes} msg-anchors, ${raw.diag.wrappers} wrappers ` +
      `(pinned: ${raw.diag.skippedPinned}, wrong-handle: ${raw.diag.skippedWrongHandle}, ` +
      `empty: ${raw.diag.skippedEmpty}, kept: ${raw.items.length})`,
    );
    if (raw.diag.detectedOwner) {
      onLog?.(`Detected owner: @${raw.diag.detectedOwner} ("${raw.diag.detectedOwnerName}") — using this instead of URL slug`);
    } else if (raw.diag.ownerCounts.length > 0) {
      onLog?.(
        `No dominant owner detected. Top handles: ` +
        raw.diag.ownerCounts.map((o) => `@${o.handle}×${o.count}`).join(", "),
      );
    }
    // Dump per-wrapper details to the existing /tmp/fb-debug.html.
    try {
      const fs = await import("node:fs/promises");
      const lines = raw.diag.wrapperDiag.map((w, i) => {
        const head = `<!-- wrap[${i}] handle="${w.handle}" name="${w.displayName}" permalinkOwner="${w.permalinkOwner || ""}" permalink="${w.permalink || ""}" -->`;
        const hrefs = (w.debugHrefs || []).map((h) => `<!--   href: ${h.replace(/-->/g, "--&gt;")} -->`).join("\n");
        return head + (hrefs ? "\n" + hrefs : "");
      });
      const extra = `\n\n<!-- desktop-extractor wrapper diag (${raw.diag.wrappers} total) -->\n` +
        `<!-- effectiveOwner=${raw.diag.effectiveOwner} detectedOwner=${raw.diag.detectedOwner} -->\n` +
        lines.join("\n");
      await fs.appendFile("/tmp/fb-debug.html", extra);
    } catch {
      /* noop */
    }

    if (raw.items.length === 0) {
      if (raw.diag.messageNodes === 0) {
        errors.push(
          "No post-message containers found on the page. The profile may be empty, private, " +
          "or Facebook may be showing a non-feed view (notifications, settings, etc.). " +
          "Open the profile in the browser, scroll until posts are visible, then retry.",
        );
      } else if (raw.diag.skippedWrongHandle > 0 && expectedHandle) {
        errors.push(
          `No posts for @${expectedHandle} — ${raw.diag.skippedWrongHandle} candidates belonged to other profiles.`,
        );
      } else {
        errors.push("Found post wrappers but none had extractable text or media.");
      }
      return { posts, errors };
    }

    let idx = 0;
    for (const item of raw.items) {
      idx++;
      onLog?.(`${idx}/${raw.items.length}: ${item.handle ? `@${item.handle}` : "(no handle)"} — "${(item.text || "(no text)").slice(0, 60)}"`);

      // Fetch the post author's own comments via the permalink page. FB's
      // feed view often doesn't render the full comment thread inline, but
      // the dedicated permalink page does — and own-comments are explicitly
      // tagged with a "Verfasser" / "Author" badge there.
      if (item.permalink && raw.diag.effectiveOwner) {
        try {
          const ownComments = await fetchOwnCommentsFromPermalink(
            page,
            item.permalink,
            raw.diag.effectiveOwner,
            raw.diag.detectedOwnerName || item.displayName || "",
          );
          if (ownComments.length > 0) {
            item.text = (item.text + "\n\n" + ownComments.map((c) => `[Eigener Kommentar]\n${c}`).join("\n\n")).trim();
            onLog?.(`${idx}/${raw.items.length}: + ${ownComments.length} eigene Kommentare`);
          }
        } catch (e) {
          onLog?.(`${idx}/${raw.items.length}: comment fetch failed (${e instanceof Error ? e.message : String(e)})`);
        }
      }

      const hashtags = Array.from(item.text.matchAll(/#(\w+)/g)).map((m) => m[1]);
      const mentions = Array.from(item.text.matchAll(/@(\w+)/g)).map((m) => m[1]);
      const cta = detectCta(item.text);
      const hook = extractHook(item.text);

      let visionDescription = "";
      if (item.mediaUrls.length > 0) {
        onLog?.(`${idx}/${raw.items.length}: vision describe…`);
        try {
          visionDescription = await describeImageByUrl(item.mediaUrls[0]);
        } catch (e) {
          onLog?.(`${idx}/${raw.items.length}: vision failed (${e instanceof Error ? e.message : String(e)})`);
        }
      }

      const id = `fb-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const post: LibraryPost = {
        id,
        platform: "facebook",
        source,
        url: item.permalink || page.url(),
        author: { handle: item.handle, displayName: item.displayName || undefined },
        text: item.text,
        hook,
        cta,
        hashtags,
        mentions,
        media: [
          ...item.mediaUrls.map((remoteUrl, i) => ({
            type: "image" as const,
            localPath: null,
            remoteUrl,
            description: i === 0 ? visionDescription : "",
          })),
          ...item.videoUrls.map((remoteUrl) => ({
            type: "video" as const,
            localPath: null,
            remoteUrl,
            description: "",
          })),
        ],
        engagement: {
          likes: item.likes,
          comments: item.comments,
          shares: item.shares,
          views: null,
          saves: null,
        },
        engagementRate: null,
        postType: item.postType as LibraryPost["postType"],
        postedAt: item.postedAt,
        tags: [],
        isGold: false,
        extractedAt: new Date().toISOString(),
        notes: "",
      };
      posts.push(post);
    }
  } catch (e) {
    errors.push(`Facebook desktop feed scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { posts, errors };
}

/**
 * Open a post's permalink in a background tab, expand all comments, and
 * return the bodies of comments authored by `ownerHandle`. The permalink
 * page renders the full comment thread (including FB's "Verfasser" / "Author"
 * badge on own-comments) which the feed view often omits.
 */
async function fetchOwnCommentsFromPermalink(
  basePage: Page,
  permalink: string,
  ownerHandle: string,
  ownerDisplayName: string,
): Promise<string[]> {
  const tab = await basePage.context().newPage();
  try {
    await tab.goto(permalink, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await tab.waitForTimeout(2000);

    // Click "View previous comments" / "Weitere Kommentare anzeigen" /
    // "Antworten anzeigen" repeatedly to surface deeper threads.
    for (let pass = 0; pass < 6; pass++) {
      const clicked = await tab.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll("div[role='button'], span[role='button'], span"),
        ) as HTMLElement[];
        const re = /^(weitere kommentare anzeigen|view more comments|alle kommentare anzeigen|view all comments|previous comments|vorherige kommentare|antworten anzeigen|view replies?|view all \d+ replies?|\d+ antworten|\d+ replies?|kommentar(e)? anzeigen)$/i;
        let n = 0;
        for (const el of candidates) {
          if (!el.isConnected) continue;
          const t = (el.textContent || "").trim();
          if (t.length === 0 || t.length > 60) continue;
          if (re.test(t)) {
            try { el.click(); n++; } catch { /* noop */ }
          }
        }
        return n;
      }).catch(() => 0);
      if (!clicked) break;
      await tab.waitForTimeout(900);
    }

    // Click "See more" inside any truncated comments.
    await tab.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll("div[role='button'], span[role='button'], span"),
      ) as HTMLElement[];
      for (const el of candidates) {
        if (!el.isConnected) continue;
        const t = (el.textContent || "").trim();
        if (t.length > 30) continue;
        const lc = t.toLowerCase();
        if (lc === "see more" || lc === "mehr anzeigen" || lc === "weiterlesen" || lc === "...mehr" || lc === "show more") {
          try { el.click(); } catch { /* noop */ }
        }
      }
    }).catch(() => {});
    await tab.waitForTimeout(500);

    const comments = await tab.evaluate(() => {
      // Strategy: walk ALL [role='article'] elements that have a
      // "Verfasser" / "Author" badge inside. FB tags comments by the post
      // author with that badge regardless of who reshared the post — so this
      // is more reliable than matching against an upstream-detected owner
      // handle (which would be the resharer's handle, not the original
      // author's, on shared posts).
      const articles = Array.from(document.querySelectorAll("[role='article']")) as HTMLElement[];
      const results: string[] = [];
      const seen = new Set<string>();
      let postAuthorName = "";

      for (const c of articles) {
        if (results.length >= 12) break;

        const al = (c.getAttribute("aria-label") || "").trim();
        // Comment articles only — skip the post itself (no aria-label or
        // a non-comment aria-label like "Beitrag von X").
        if (!/^(Kommentar|Comment|Reply|Antwort)/i.test(al)) continue;

        // "Verfasser" / "Author" badge inside?
        const hasBadge = Array.from(c.querySelectorAll("span, div")).some((el) => {
          const t = (el.textContent || "").trim();
          return t === "Verfasser" || t === "Author";
        });
        if (!hasBadge) continue;

        // Capture the post-author display name from aria-label
        // (= "Kommentar von <Name> (...)" / "Comment by <Name>").
        if (!postAuthorName) {
          const m = al.match(/^(?:Kommentar von|Comment by|Antwort von|Reply by)\s+(.+?)(?:\s*\(.*\))?$/i);
          if (m) postAuthorName = m[1].trim();
        }

        // Body: clone, strip nested role='article' (replies), strip the
        // action row links / "Verfasser" badge / author-name / timestamp.
        const cClone = c.cloneNode(true) as HTMLElement;
        for (const inner of Array.from(cClone.querySelectorAll("[role='article']"))) {
          if (inner !== cClone) inner.remove();
        }
        for (const el of Array.from(cClone.querySelectorAll("span, div"))) {
          const t = (el.textContent || "").trim();
          if (t === "Verfasser" || t === "Author") el.remove();
        }

        let body = (cClone.innerText || "").trim();
        body = body
          .split("\n")
          .map((l) => l.trimEnd())
          .filter((line, idx, arr) => {
            const tr = line.trim();
            if (!tr) return false;
            // First two lines are typically "Verfasser" + "<Author Name>" —
            // we already removed "Verfasser", but the author name remains.
            // Drop it when seen as a standalone first line.
            if (idx < 2 && postAuthorName && tr === postAuthorName) return false;
            // Drop trailing meta lines: timestamp, "Antworten", "Gefällt mir"…
            if (/^\d+\s*(Min|Std|Tag|Tagen|Wo|Mon|Jahr|min|h|d|w)\.?$/i.test(tr)) return false;
            if (/^vor\s+\d+\s+(Min|Stunden?|Tagen?|Wochen?|Monaten?|Jahren?)/i.test(tr)) return false;
            if (tr === "Antworten" || tr === "Reply" || tr === "Gefällt mir" || tr === "Like" || tr === "Teilen" || tr === "Share") return false;
            // Last few lines: "Bearbeitet" / "Edited" markers
            if (idx >= arr.length - 3 && (tr === "Bearbeitet" || tr === "Edited")) return false;
            return true;
          })
          .join("\n")
          .trim();
        if (body.length < 10) continue;
        const sig = body.slice(0, 100);
        if (seen.has(sig)) continue;
        seen.add(sig);
        results.push(body);
      }
      return results;
    });

    return comments;
  } finally {
    await tab.close().catch(() => { /* noop */ });
  }
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
