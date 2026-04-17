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
