// ─── Browser Manager ─────────────────────────────────────────────────────────
// Manages a headed Chromium per platform, rendered into a shared Xvfb display
// (:99). Each platform has a persistent user-data-dir so cookies/session
// survive restarts. User logs in once manually via the noVNC viewer.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { HEYHANK_HOME } from "../paths.js";
import { PLATFORM_URLS, type SocialPlatform, type SocialViewStatus } from "./types.js";

const DISPLAY = ":99";
const DISPLAY_WIDTH = 1440;
const DISPLAY_HEIGHT = 900;
const PROFILES_DIR = join(HEYHANK_HOME, "browser-profiles");

let xvfbProc: ChildProcess | null = null;

interface Session {
  platform: SocialPlatform;
  context: BrowserContext;
  page: Page;
  startedAt: number;
}

const sessions = new Map<SocialPlatform, Session>();

/** Start Xvfb on DISPLAY if not running. Idempotent. */
async function ensureXvfb(): Promise<void> {
  if (xvfbProc && !xvfbProc.killed && xvfbProc.exitCode === null) return;
  // eslint-disable-next-line no-console
  console.log(`[socialview] starting Xvfb on ${DISPLAY}`);
  xvfbProc = spawn(
    "Xvfb",
    [DISPLAY, "-screen", "0", `${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x24`, "-ac", "+extension", "RANDR"],
    { stdio: "ignore", detached: false },
  );
  xvfbProc.on("exit", (code) => {
    // eslint-disable-next-line no-console
    console.log(`[socialview] Xvfb exited with code ${code}`);
    xvfbProc = null;
  });
  // Give Xvfb a moment to start listening on the display socket.
  await new Promise((r) => setTimeout(r, 500));
}

/** Launch a persistent-context Chromium for a platform, navigate to its URL. */
export async function startPlatform(platform: SocialPlatform): Promise<SocialViewStatus> {
  const existing = sessions.get(platform);
  if (existing && !existing.page.isClosed()) {
    return getStatus(platform);
  }

  await ensureXvfb();

  mkdirSync(PROFILES_DIR, { recursive: true });
  const userDataDir = join(PROFILES_DIR, platform);
  mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT },
    env: { ...process.env, DISPLAY },
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--window-size=${DISPLAY_WIDTH},${DISPLAY_HEIGHT}`,
      "--window-position=0,0",
    ],
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(PLATFORM_URLS[platform], { waitUntil: "domcontentloaded" }).catch(() => {
    // Navigation errors are non-fatal; user can manually retry.
  });

  const session: Session = { platform, context, page, startedAt: Date.now() };
  sessions.set(platform, session);

  context.on("close", () => {
    sessions.delete(platform);
  });

  return getStatus(platform);
}

export async function stopPlatform(platform: SocialPlatform): Promise<void> {
  const s = sessions.get(platform);
  if (!s) return;
  try {
    await s.context.close();
  } finally {
    sessions.delete(platform);
  }
}

export interface NormalizedCookie {
  name: string;
  value: string;
  domain?: string;
  url?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * Normalize the cookie-array shapes emitted by different browser extensions
 * (Cookie-Editor, EditThisCookie, Get-cookies.txt-as-JSON) into the canonical
 * Playwright shape. Pure function — testable without spinning up Playwright.
 *
 * Returns { normalized, rejected, errors }. Invalid entries are skipped rather
 * than throwing so the user gets all the working cookies even if 1-2 are
 * malformed.
 */
export function normalizeCookies(input: unknown): {
  normalized: NormalizedCookie[];
  rejected: number;
  errors: string[];
} {
  if (!Array.isArray(input)) {
    return { normalized: [], rejected: 0, errors: ["cookies payload is not an array"] };
  }
  const normalized: NormalizedCookie[] = [];
  const errors: string[] = [];
  for (const raw of input as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== "object") {
      errors.push("entry is not an object");
      continue;
    }
    const name = typeof raw.name === "string" ? raw.name : null;
    const value = typeof raw.value === "string" ? raw.value : null;
    if (!name || value === null) {
      errors.push(`missing name/value: ${JSON.stringify(raw).slice(0, 80)}`);
      continue;
    }
    const domain = typeof raw.domain === "string" ? raw.domain : undefined;
    const url = typeof raw.url === "string" ? raw.url : undefined;
    if (!domain && !url) {
      errors.push(`cookie "${name}" has neither domain nor url`);
      continue;
    }
    const path = typeof raw.path === "string" ? raw.path : "/";
    // Different extensions use different keys for the expiration timestamp.
    let expires: number | undefined;
    const expCandidate = (raw.expires ?? raw.expirationDate ?? raw.expiry) as unknown;
    if (typeof expCandidate === "number" && expCandidate > 0) {
      expires = Math.floor(expCandidate);
    }
    let sameSite: "Strict" | "Lax" | "None" | undefined;
    if (typeof raw.sameSite === "string") {
      const s = raw.sameSite.toLowerCase();
      if (s === "strict") sameSite = "Strict";
      else if (s === "lax") sameSite = "Lax";
      else if (s === "none" || s === "no_restriction") sameSite = "None";
    }
    normalized.push({
      name,
      value,
      domain,
      url,
      path,
      expires,
      httpOnly: !!raw.httpOnly,
      secure: !!raw.secure,
      sameSite,
    });
  }
  return { normalized, rejected: (input as unknown[]).length - normalized.length, errors };
}

/**
 * Apply a batch of cookies to the platform's persistent context. Used by the
 * cookie-import flow: user logs in on their normal browser (where IG doesn't
 * shadow-ban them), exports cookies via a browser extension, and hands them
 * over. Playwright then has a "real" session and doesn't have to attempt the
 * login flow at all — IG sees an already-authenticated user.
 *
 * Auto-starts the platform if not running yet so the user can paste cookies
 * before they've manually clicked "Start". Cookies persist to disk via the
 * userDataDir, so subsequent crawls reuse them.
 */
export async function applyCookies(
  platform: SocialPlatform,
  cookies: unknown,
): Promise<{ imported: number; rejected: number; errors: string[] }> {
  const { normalized, rejected, errors } = normalizeCookies(cookies);
  if (normalized.length === 0) {
    return { imported: 0, rejected, errors };
  }
  // Boot the browser if needed — caller doesn't have to startPlatform first.
  let s = sessions.get(platform);
  if (!s || s.page.isClosed()) {
    await startPlatform(platform);
    s = sessions.get(platform);
    if (!s) throw new Error("Failed to start browser for cookie import");
  }
  try {
    await s.context.addCookies(normalized as Parameters<typeof s.context.addCookies>[0]);
  } catch (e) {
    throw new Error(`Playwright rejected cookies: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Reload so the freshly-applied cookies take effect on the visible noVNC
  // view too (otherwise the user sees a logged-out page despite the import).
  await s.page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  return { imported: normalized.length, rejected, errors };
}

export async function gotoUrl(platform: SocialPlatform, url: string): Promise<SocialViewStatus> {
  const s = sessions.get(platform);
  if (!s) throw new Error(`Platform ${platform} not running`);
  await s.page.goto(url, { waitUntil: "domcontentloaded" });
  return getStatus(platform);
}

export function getStatus(platform: SocialPlatform): SocialViewStatus {
  const s = sessions.get(platform);
  if (!s) {
    return { platform, running: false, loggedIn: null, currentUrl: null, startedAt: null };
  }
  const currentUrl = s.page.isClosed() ? null : s.page.url();
  // Heuristic: URL contains "login" or "signin" or is root → not logged in
  const loggedIn =
    currentUrl === null
      ? null
      : !/\/(login|signin|accounts\/login|uas\/login)/i.test(currentUrl);
  return {
    platform,
    running: !s.page.isClosed(),
    loggedIn,
    currentUrl,
    startedAt: s.startedAt,
  };
}

/** Returns the live Playwright Page for a running platform, or null. */
export function getPage(platform: SocialPlatform): Page | null {
  const s = sessions.get(platform);
  if (!s || s.page.isClosed()) return null;
  return s.page;
}

export function getAllStatus(): SocialViewStatus[] {
  const platforms: SocialPlatform[] = ["instagram", "twitter", "linkedin", "facebook", "tiktok"];
  return platforms.map(getStatus);
}

export function hasProfile(platform: SocialPlatform): boolean {
  return existsSync(join(PROFILES_DIR, platform));
}

/** Shut down all browsers + Xvfb. Called on process exit. */
export async function shutdown(): Promise<void> {
  for (const p of Array.from(sessions.keys())) {
    await stopPlatform(p).catch(() => {});
  }
  if (xvfbProc && !xvfbProc.killed) {
    xvfbProc.kill();
    xvfbProc = null;
  }
}
