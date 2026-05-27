// ─── Facebook Page Comments Polling ─────────────────────────────────────────
// Workaround for Meta's dev-mode webhook silence: even App Admins don't
// receive real comment webhooks on Page-Posts unless pages_read_engagement is
// granted Advanced Access via App Review (5-10 days). Until then we poll the
// Page's /{pageId}/feed every 60 seconds and route new comments through the
// same Match-Engine + Send-Worker the webhook receiver uses.
//
// Once App Review is approved this module can be disabled via env var; the
// webhook receiver takes over automatically without any code changes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "../paths.js";
import { getMetaSecrets } from "./meta-secrets.js";
import { processCommentEvent } from "./meta-webhook-routes.js";
import type { CommentEvent } from "./meta-webhook.js";

const AUTOMATION_DIR = join(HEYHANK_HOME, "automation");
const STATE_FILE = join(AUTOMATION_DIR, "fb-poll-state.json");
const GRAPH_BASE = "https://graph.facebook.com/v21.0";

/** Default cadence — 60s is well within Facebook's per-token rate limits
 *  (~200 calls/hour for /feed reads) and matches typical Auto-DM expectations. */
const DEFAULT_INTERVAL_MS = 60_000;

/** Cap on processed-comment IDs we remember to dedupe. Older IDs roll off the
 *  back of the array. Realistically 200 covers ~10 minutes of high-volume
 *  comment streams, well past any retry window we'd care about. */
const PROCESSED_RING_SIZE = 200;

interface PollState {
  /** ISO timestamp of the most recent successful poll. Used as `since=` on
   *  the next Graph API call so we only see new comments. */
  lastPollAt: string;
  /** Ring buffer of comment IDs we've already processed. Belt-and-suspenders
   *  dedupe in case Graph returns the same comment in two consecutive polls
   *  (e.g. due to comment_count vs since boundary races). */
  processedCommentIds: string[];
}

function ensureDirs(): void {
  if (!existsSync(AUTOMATION_DIR)) mkdirSync(AUTOMATION_DIR, { recursive: true, mode: 0o700 });
}

function readState(): PollState {
  ensureDirs();
  if (!existsSync(STATE_FILE)) {
    // First-run default: start from 5 minutes ago so we don't replay weeks of
    // historical comments on the very first poll. Existing Auto-DM rules
    // explicitly meant for already-published posts should be wired up
    // BEFORE the post receives any comments anyway.
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    return { lastPollAt: since, processedCommentIds: [] };
  }
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PollState>;
    return {
      lastPollAt: parsed.lastPollAt ?? new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      processedCommentIds: Array.isArray(parsed.processedCommentIds) ? parsed.processedCommentIds : [],
    };
  } catch {
    return { lastPollAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), processedCommentIds: [] };
  }
}

function writeState(state: PollState): void {
  ensureDirs();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// ─── Graph API shape we read ────────────────────────────────────────────────

interface GraphComment {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id?: string; name?: string };
}

interface GraphPost {
  id: string;
  comments?: { data?: GraphComment[] };
}

interface GraphFeedResponse {
  data?: GraphPost[];
  error?: { message?: string; code?: number };
}

/**
 * Single poll cycle. Reads up to 25 recent Page posts with their comments,
 * filters out (a) anything in our processed-ring, (b) anything older than the
 * last poll, then dispatches each remaining comment as a synthetic
 * CommentEvent to the existing webhook-style processing pipeline.
 *
 * Returns a summary so the cron loop can log progress + tests can assert.
 */
export async function pollOnce(): Promise<{
  ok: boolean;
  postsScanned: number;
  newComments: number;
  matched: number;
  sent: number;
  error?: string;
}> {
  const secrets = getMetaSecrets();
  if (!secrets.pageId || !secrets.pageAccessToken) {
    return { ok: false, postsScanned: 0, newComments: 0, matched: 0, sent: 0, error: "FB Page not configured" };
  }

  const state = readState();
  const sinceUnix = Math.floor(Date.parse(state.lastPollAt) / 1000);

  // Pull recent posts with their comments inline. `?fields=comments{...}`
  // gets us nested comment objects in a single request instead of N+1.
  const url =
    `${GRAPH_BASE}/${encodeURIComponent(secrets.pageId)}/feed` +
    `?fields=id,comments.since(${sinceUnix}){id,message,created_time,from{id,name}}` +
    `&limit=25` +
    `&access_token=${encodeURIComponent(secrets.pageAccessToken)}`;

  let body: GraphFeedResponse;
  try {
    const res = await fetch(url);
    body = (await res.json()) as GraphFeedResponse;
    if (!res.ok || body.error) {
      return {
        ok: false,
        postsScanned: 0,
        newComments: 0,
        matched: 0,
        sent: 0,
        error: body.error?.message ?? `HTTP ${res.status}`,
      };
    }
  } catch (e) {
    return { ok: false, postsScanned: 0, newComments: 0, matched: 0, sent: 0, error: e instanceof Error ? e.message : String(e) };
  }

  const posts = body.data ?? [];
  const processedSet = new Set(state.processedCommentIds);
  let newComments = 0;
  let matched = 0;
  let sent = 0;
  const newlyProcessed: string[] = [];

  for (const post of posts) {
    const comments = post.comments?.data ?? [];
    for (const c of comments) {
      if (!c.id || !c.from?.id) continue;
      if (processedSet.has(c.id)) continue;
      newComments++;

      const event: CommentEvent = {
        platform: "facebook",
        postId: post.id,
        commentId: c.id,
        commenterId: c.from.id,
        commenterName: c.from.name,
        text: c.message ?? "",
        receivedAt: c.created_time ? Date.parse(c.created_time) : Date.now(),
      };

      try {
        const result = await processCommentEvent(event);
        if (result.matched) matched++;
        if (result.sent) sent++;
      } catch (err) {
        console.error(`[fb-poll] processCommentEvent failed for ${c.id}:`, err instanceof Error ? err.message : err);
      }

      newlyProcessed.push(c.id);
    }
  }

  // Persist state — `lastPollAt` always moves forward (even if no new
  // comments) so a quiet hour doesn't permanently widen the since-window.
  const updatedRing = [...state.processedCommentIds, ...newlyProcessed].slice(-PROCESSED_RING_SIZE);
  writeState({ lastPollAt: new Date().toISOString(), processedCommentIds: updatedRing });

  return { ok: true, postsScanned: posts.length, newComments, matched, sent };
}

let pollerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the polling cron. Safe to call multiple times — re-invocation is a
 * no-op when the poller is already running. Set HEYHANK_FB_POLL_DISABLE=1 to
 * disable entirely (e.g. after App Review is approved + webhooks take over).
 */
export function startFbCommentPoller(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (pollerHandle) return;
  if (process.env.HEYHANK_FB_POLL_DISABLE === "1") {
    console.log("[fb-poll] disabled via HEYHANK_FB_POLL_DISABLE=1");
    return;
  }

  console.log(`[fb-poll] starting Facebook comments poller — interval=${intervalMs}ms`);
  // Fire immediately on startup, then on the interval. Wrapping in a try/catch
  // so a single transient Graph error doesn't kill the cron.
  const tick = async () => {
    try {
      const summary = await pollOnce();
      if (summary.error) {
        console.error(`[fb-poll] error: ${summary.error}`);
      } else if (summary.newComments > 0) {
        console.log(`[fb-poll] ${summary.postsScanned} posts, ${summary.newComments} new comments, ${summary.matched} matched, ${summary.sent} sent`);
      }
    } catch (err) {
      console.error("[fb-poll] tick crashed:", err instanceof Error ? err.message : err);
    }
  };
  void tick();
  pollerHandle = setInterval(tick, intervalMs);
}

/** Stop the poller. Useful for tests + graceful shutdown. */
export function stopFbCommentPoller(): void {
  if (pollerHandle) {
    clearInterval(pollerHandle);
    pollerHandle = null;
  }
}

/** Test helper: reset internal state so tests can re-exercise from scratch. */
export function _resetForTest(): void {
  stopFbCommentPoller();
  if (existsSync(STATE_FILE)) {
    writeState({ lastPollAt: new Date(0).toISOString(), processedCommentIds: [] });
  }
}
