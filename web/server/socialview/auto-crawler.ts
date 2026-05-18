// ─── SocialView Auto-Crawler ─────────────────────────────────────────────────
// Cron-driven crawler that iterates the watch-list, visits each enabled
// creator's profile, and stores extracted posts in the role-model library.
//
// Design:
//   - Schedule: daily at 04:17 (off-peak, low chance of overlap with user
//     manual extraction).
//   - One browser per platform — startPlatform if not already running.
//   - Skip platforms where the user has never logged in (no persisted profile).
//   - Process entries sequentially within a platform; short delay between
//     visits to avoid tripping anti-bot heuristics.
//   - Per-entry failures are isolated — one bad profile doesn't abort the run.
//   - Each attempt stamps lastCrawledAt + lastCrawlStatus + posts-extracted
//     count on the watch-list entry, surfaced in the UI.

import { Cron } from "croner";
import * as browser from "./browser-manager.js";
import * as library from "./library.js";
import * as watchList from "./watch-list.js";
import { extractCurrentPage } from "./extractors.js";
import { SOCIAL_PLATFORMS, buildProfileUrl, type SocialPlatform, type WatchListEntry } from "./types.js";

/** Crontab string for the nightly run. 04:17 daily — off-peak, prime-ish minute to avoid round-number contention. */
const DEFAULT_SCHEDULE = process.env.HEYHANK_SOCIALVIEW_CRAWL_SCHEDULE || "17 4 * * *";

/** Milliseconds to wait between two profile visits on the same platform. */
const VISIT_DELAY_MS = Number(process.env.HEYHANK_SOCIALVIEW_VISIT_DELAY_MS || "3000");

let scheduled: Cron | null = null;
let running = false;

export interface CrawlSummary {
  totalEntries: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  postsExtracted: number;
  startedAt: string;
  finishedAt: string;
  /** Per-platform breakdown for diagnostics. */
  platforms: Record<string, { skipped: boolean; reason?: string; entries: number; postsExtracted: number }>;
}

/**
 * Run one full crawl across all enabled watch-list entries.
 *
 * Returns a summary even on partial failure — callers (cron, manual route)
 * surface that to the user. Mutually-exclusive: a second invocation while
 * a crawl is already running returns immediately with `attempted: 0` so
 * scheduled + manual triggers can't trample each other.
 */
export async function crawlOnce(): Promise<CrawlSummary> {
  const startedAt = new Date().toISOString();
  const summary: CrawlSummary = {
    totalEntries: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    postsExtracted: 0,
    startedAt,
    finishedAt: startedAt,
    platforms: {},
  };

  if (running) {
    summary.finishedAt = new Date().toISOString();
    return summary;
  }
  running = true;

  try {
    const allEnabled = watchList.list({ enabledOnly: true });
    summary.totalEntries = allEnabled.length;

    for (const platform of SOCIAL_PLATFORMS) {
      const entries = allEnabled.filter((e) => e.platform === platform);
      if (entries.length === 0) continue;

      summary.platforms[platform] = { skipped: false, entries: entries.length, postsExtracted: 0 };

      // Skip platforms the user has never logged into — browser would launch
      // straight to a login wall and extraction would yield nothing useful.
      if (!browser.hasProfile(platform)) {
        summary.platforms[platform].skipped = true;
        summary.platforms[platform].reason = "no login profile (open SocialView, log in once via noVNC)";
        for (const entry of entries) {
          watchList.update(entry.id, {
            lastCrawledAt: new Date().toISOString(),
            lastCrawlStatus: "error",
            lastCrawlMessage: "platform has no login profile yet",
          });
          summary.skipped++;
        }
        continue;
      }

      // Boot the browser if not running. The user may have left it stopped
      // overnight — we start it on-demand. We don't auto-stop afterwards
      // because the user may want to re-use the session for manual work.
      const status = browser.getStatus(platform);
      if (!status.running) {
        try {
          await browser.startPlatform(platform);
        } catch (e) {
          summary.platforms[platform].skipped = true;
          summary.platforms[platform].reason = `failed to start browser: ${e instanceof Error ? e.message : String(e)}`;
          for (const entry of entries) {
            watchList.update(entry.id, {
              lastCrawledAt: new Date().toISOString(),
              lastCrawlStatus: "error",
              lastCrawlMessage: `browser start failed: ${e instanceof Error ? e.message : "unknown"}`,
            });
            summary.skipped++;
          }
          continue;
        }
      }

      // Process this platform's entries in series — they share a single
      // browser and we don't want to navigate while another navigation is
      // in flight.
      for (const entry of entries) {
        summary.attempted++;
        const result = await crawlEntry(entry);
        if (result.ok) {
          summary.succeeded++;
          summary.postsExtracted += result.postsExtracted;
          summary.platforms[platform].postsExtracted += result.postsExtracted;
        } else {
          summary.failed++;
        }
        // Polite delay so we don't hammer the platform — anti-bot heuristics
        // hate identical-cadence requests.
        if (entries.indexOf(entry) < entries.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, VISIT_DELAY_MS));
        }
      }
    }
  } finally {
    running = false;
    summary.finishedAt = new Date().toISOString();
  }

  return summary;
}

interface EntryCrawlResult {
  ok: boolean;
  postsExtracted: number;
  error?: string;
}

/** Crawl a single watch-list entry. Stamps the result on the entry. */
export async function crawlEntry(entry: WatchListEntry): Promise<EntryCrawlResult> {
  try {
    const page = browser.getPage(entry.platform);
    if (!page) {
      const error = "browser page not available";
      watchList.update(entry.id, {
        lastCrawledAt: new Date().toISOString(),
        lastCrawlStatus: "error",
        lastCrawlMessage: error,
      });
      return { ok: false, postsExtracted: 0, error };
    }

    const profileUrl = buildProfileUrl(entry.platform, entry.handle);
    await browser.gotoUrl(entry.platform, profileUrl);

    const result = await extractCurrentPage({ platform: entry.platform, page, source: "role-model" });
    for (const post of result.posts) library.savePost(post);

    const postsExtracted = result.posts.length;
    watchList.update(entry.id, {
      lastCrawledAt: new Date().toISOString(),
      lastCrawlStatus: result.errors.length > 0 && postsExtracted === 0 ? "error" : "ok",
      lastCrawlMessage: result.errors.length > 0 ? result.errors.join("; ").slice(0, 500) : undefined,
      lastCrawlPostsExtracted: postsExtracted,
    });
    return { ok: postsExtracted > 0 || result.errors.length === 0, postsExtracted };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    watchList.update(entry.id, {
      lastCrawledAt: new Date().toISOString(),
      lastCrawlStatus: "error",
      lastCrawlMessage: error.slice(0, 500),
    });
    return { ok: false, postsExtracted: 0, error };
  }
}

/** Start the nightly cron. Called once at server bootstrap. */
export function startAutoCrawler(schedule: string = DEFAULT_SCHEDULE): void {
  if (scheduled) {
    console.warn("[socialview-crawler] already scheduled, ignoring duplicate start");
    return;
  }
  scheduled = new Cron(schedule, {}, () => {
    crawlOnce()
      .then((summary) => {
        console.log(
          `[socialview-crawler] nightly crawl done: ${summary.succeeded}/${summary.totalEntries} ok, ` +
          `${summary.postsExtracted} posts extracted, ${summary.failed} failed, ${summary.skipped} skipped`,
        );
      })
      .catch((e) => console.error("[socialview-crawler] crawl error", e));
  });
  console.log(`[socialview-crawler] scheduled with cron "${schedule}"`);
}

export function stopAutoCrawler(): void {
  scheduled?.stop();
  scheduled = null;
}

/** Test-only: report whether a crawl is currently in flight. */
export function _isRunning(): boolean {
  return running;
}

/** Test-only: reset the in-flight flag. */
export function _resetForTest(): void {
  running = false;
  scheduled?.stop();
  scheduled = null;
}
