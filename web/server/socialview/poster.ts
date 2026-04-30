// ─── SocialView Poster ───────────────────────────────────────────────────────
// Browser-based posting for X (Twitter) and TikTok. Reuses the persistent
// Playwright context from browser-manager.ts, so the user's manual login
// (via noVNC) carries over. No headless — user can watch actions live.
//
// Scope v1:
//   - X: text + optional single image
//   - TikTok: video + description
//
// Selectors are stable `data-testid` attributes (X) / reasonably stable ARIA
// roles (TikTok). If UI changes break a selector, the caller surfaces the
// error and the user can inspect via noVNC.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { HEYHANK_HOME } from "../paths.js";

// ─── Media resolution (mirrors postiz-adapter) ───────────────────────────────

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

/** Detect MIME from file's magic bytes. See postiz-adapter.ts for rationale. */
function detectMimeFromBytes(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return "video/mp4";
  return null;
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

function extractLocalMediaFilename(url: string): string | null {
  try {
    const withoutHost = url.replace(/^https?:\/\/[^/]+/i, "");
    const match = withoutHost.match(/^\/api\/media\/file\/([^/?#]+)/);
    if (!match) return null;
    return basename(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

/**
 * Resolve a media URL to a local disk path that Playwright's
 * `setInputFiles` can consume. Handles:
 *   - local HeyHank media (/api/media/file/<name>) — reads from ~/.heyhank/media
 *   - absolute http(s) URLs — downloaded to /tmp
 * Applies magic-byte detection so a JPEG saved with a .png extension
 * is renamed to .jpg before being handed to the browser upload widget.
 */
export async function resolveMediaToDiskPath(url: string): Promise<string> {
  const localName = extractLocalMediaFilename(url);
  let buf: Uint8Array;
  let originalName: string;

  if (localName) {
    const local = join(HEYHANK_HOME, "media", localName);
    if (!existsSync(local)) throw new Error(`Local media file not found: ${localName}`);
    buf = readFileSync(local);
    originalName = localName;
  } else if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch media URL ${url}: ${res.status}`);
    buf = new Uint8Array(await res.arrayBuffer());
    const urlPath = url.split(/[?#]/)[0];
    originalName = basename(urlPath) || `media_${randomUUID()}`;
  } else {
    throw new Error(`Unsupported media URL: ${url}`);
  }

  const extFromName = originalName.split(".").pop()?.toLowerCase() ?? "";
  const sniffed = detectMimeFromBytes(buf);
  const correctExt = sniffed ? extForMime(sniffed) : (MIME_BY_EXT[extFromName] ? extFromName : "bin");
  const finalName =
    correctExt && correctExt !== extFromName
      ? `${originalName.replace(/\.[^.]+$/, "")}.${correctExt}`
      : originalName;

  const stageDir = join(tmpdir(), "heyhank-browser-upload");
  mkdirSync(stageDir, { recursive: true });
  const finalPath = join(stageDir, `${Date.now()}_${randomUUID()}_${finalName}`);
  writeFileSync(finalPath, buf);
  return finalPath;
}

// ─── Humanized delays ────────────────────────────────────────────────────────

function humanDelay(minMs = 50, maxMs = 200): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, ms));
}

export interface PostResult {
  url: string | null;
}

// ─── X (Twitter) ─────────────────────────────────────────────────────────────

export interface PostToXOpts {
  text: string;
  imagePath?: string;
}

export async function postToX(page: Page, opts: PostToXOpts): Promise<PostResult> {
  // The dedicated compose URL pops the composer dialog directly, avoiding
  // the timeline's "What's happening?" inline-vs-modal ambiguity.
  await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });
  await humanDelay(600, 1100);

  // 1) Find the tweet textarea. X uses a stable data-testid.
  const textareaSelector = '[data-testid="tweetTextarea_0"]';
  await page.waitForSelector(textareaSelector, { timeout: 30_000 });
  const textarea = await page.$(textareaSelector);
  if (!textarea) throw new Error("X tweet textarea not found");

  await textarea.click();
  await humanDelay(80, 180);
  await page.keyboard.type(opts.text, { delay: 25 });
  await humanDelay(300, 700);

  // 2) Optional single image upload via the hidden file input.
  if (opts.imagePath) {
    const fileInput = await page.$('[data-testid="fileInput"]') ?? await page.$('input[type="file"]');
    if (!fileInput) throw new Error("X file input not found");
    await fileInput.setInputFiles(opts.imagePath);
    // Wait for the inline preview tile so we know the upload is accepted.
    try {
      await page.waitForSelector('[data-testid="attachments"]', { timeout: 30_000 });
    } catch {
      // Some variants render the preview without that testid; soft-fail.
    }
    await humanDelay(500, 1000);
  }

  // 3) Click the Post button. X uses two ids depending on context.
  const postBtn =
    (await page.$('[data-testid="tweetButtonInline"]')) ??
    (await page.$('[data-testid="tweetButton"]'));
  if (!postBtn) throw new Error("X Post button not found");

  // Wait for the button to be enabled (text + media validation passes).
  for (let i = 0; i < 40; i++) {
    const ariaDisabled = await postBtn.getAttribute("aria-disabled");
    if (ariaDisabled !== "true") break;
    await humanDelay(200, 400);
  }

  await postBtn.click();

  // 4) After post, the composer closes and we end up on the timeline.
  //    The toast "Your post was sent" appears briefly. We don't reliably
  //    capture the new tweet's URL — return null and let the caller treat
  //    the absence of an exception as success.
  try {
    await page.waitForFunction(
      () => !location.pathname.includes("/compose"),
      { timeout: 30_000 },
    );
  } catch {
    // Composer may stay open if there was a validation issue — surface as error.
    const stillThere = await page.$(textareaSelector);
    if (stillThere) throw new Error("X post did not complete (composer still open)");
  }

  return { url: null };
}

// ─── TikTok ──────────────────────────────────────────────────────────────────

export interface PostToTiktokOpts {
  description: string;
  videoPath: string;
}

export async function postToTiktok(page: Page, opts: PostToTiktokOpts): Promise<PostResult> {
  await page.goto("https://www.tiktok.com/tiktokstudio/upload", { waitUntil: "domcontentloaded" });
  await humanDelay(800, 1400);

  // 1) The upload input is a hidden <input type="file" accept="video/*">.
  //    TikTok sometimes nests it inside a shadow-ish iframe; try top-level first.
  let fileInput = await page.$('input[type="file"][accept*="video"]');
  if (!fileInput) {
    // Fallback: any type=file input on the page.
    fileInput = await page.$('input[type="file"]');
  }
  if (!fileInput) throw new Error("TikTok video file input not found");

  await fileInput.setInputFiles(opts.videoPath);
  await humanDelay(600, 1200);

  // 2) Wait until processing finishes. TikTok shows a progress indicator
  //    while the video is being uploaded + transcoded. Heuristic: wait
  //    until we see the caption/description editor become editable.
  const descSelector = 'div[contenteditable="true"]';
  await page.waitForSelector(descSelector, { timeout: 120_000 });

  // Give transcoding a moment to settle so the Post button becomes enabled.
  await humanDelay(1500, 2500);

  // 3) Fill the description. TikTok's composer is a contenteditable div;
  //    it may pre-populate with the filename, so clear it first.
  const descEl = await page.$(descSelector);
  if (!descEl) throw new Error("TikTok description editor not found");
  await descEl.click();
  await humanDelay(100, 200);
  await page.keyboard.press("Control+A");
  await humanDelay(50, 150);
  await page.keyboard.press("Delete");
  await humanDelay(100, 200);
  await page.keyboard.type(opts.description, { delay: 25 });
  await humanDelay(400, 800);

  // 4) Click Post. TikTok's Studio uses a button with text "Post".
  //    Try a few shapes — a dedicated data-e2e first, then role=button.
  const postButton =
    (await page.$('[data-e2e="post_video_button"]')) ??
    (await page.$('button:has-text("Post")'));
  if (!postButton) throw new Error("TikTok Post button not found");

  // Button may start disabled while upload finalizes; wait until enabled.
  for (let i = 0; i < 60; i++) {
    const disabled = await postButton.getAttribute("disabled");
    const ariaDisabled = await postButton.getAttribute("aria-disabled");
    if (!disabled && ariaDisabled !== "true") break;
    await humanDelay(500, 800);
  }

  await postButton.click();

  // 5) After post, TikTok Studio typically navigates to the content manager
  //    or shows a success modal. We don't reliably get back the public URL,
  //    so we just wait for navigation away from /upload.
  try {
    await page.waitForFunction(
      () => !location.pathname.includes("/upload"),
      { timeout: 60_000 },
    );
  } catch {
    // Some versions keep you on /upload and just clear the form. If the
    // description editor is gone, treat as success.
    const stillHasEditor = await page.$(descSelector);
    if (stillHasEditor) throw new Error("TikTok post did not complete");
  }

  // v1: we don't attempt to fish the public video URL out of the studio UI.
  return { url: null };
}
