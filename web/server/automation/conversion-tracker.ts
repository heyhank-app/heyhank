// ─── Conversion Tracker ─────────────────────────────────────────────────────
// Click-tracking for the Instagram/Facebook Auto-DM funnel.
//
// When an Auto-DM fires, the DM body can embed a personalised tracking link
// (markusstoeger.com/go/<code>). Each DM-send mints ONE TrackedLink whose
// short code maps back to the rule + the specific commenter who triggered it.
// When that person taps the link, the /go redirect route records a click and
// 302s them on to the real Substack post (with UTM params for Substack-side
// attribution). That gives us the full owned funnel:
//
//   comment → DM sent → link clicked
//
// Subscribe attribution is intentionally NOT tracked here — Substack has no
// public API for it. The UTM params we append on redirect surface the source
// inside Substack's own analytics for manual reading.
//
// Storage: ~/.heyhank/automation/tracked-links.json (single JSON array).
// Single-user, low traffic — same flat-file pattern as auto-dm-rules.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { HEYHANK_HOME } from "../paths.js";
import type { AutoDmPlatform } from "./auto-dm-rules.js";

const AUTOMATION_DIR = join(HEYHANK_HOME, "automation");
const LINKS_FILE = join(AUTOMATION_DIR, "tracked-links.json");

export interface LinkClick {
  at: string; // ISO timestamp
  ua?: string; // user-agent (truncated)
  ip?: string; // best-effort client IP
}

export interface TrackedLink {
  /** Short URL-safe code embedded in the DM link. Unique per DM-send. */
  code: string;
  /** The Auto-DM rule that fired this link. */
  ruleId: string;
  /** The rule keyword at send-time (denormalised for funnel labels + UTM). */
  keyword: string;
  platform: AutoDmPlatform;
  /** The commenter who triggered the DM (so a click attributes to a person). */
  commenterId: string;
  commenterName?: string;
  postId: string;
  /** Final destination the link redirects to (the Substack post, usually). */
  targetUrl: string;
  /** Graph API message_id from the DM send, if available. */
  messageId?: string;
  /** When the DM (and thus this link) was sent. */
  createdAt: string;
  /** Every click on this link. Length 0 = sent-but-not-clicked. */
  clicks: LinkClick[];
}

/**
 * Public base for tracking links embedded in DMs. Defaults to the clean
 * markusstoeger.com/go path (a thin Next.js proxy forwards /go/<code> to this
 * backend's /api/go/<code>). Override per-deploy with HEYHANK_TRACKING_LINK_BASE.
 * No trailing slash.
 */
export function trackingLinkBase(): string {
  const raw = process.env.HEYHANK_TRACKING_LINK_BASE || "https://markusstoeger.com/go";
  return raw.replace(/\/+$/, "");
}

/** The placeholder authors put in a dmTemplate to request a tracking link. */
export const LINK_PLACEHOLDER = "{{link}}";

function ensureDirs(): void {
  if (!existsSync(AUTOMATION_DIR)) mkdirSync(AUTOMATION_DIR, { recursive: true, mode: 0o700 });
}

function readAll(): TrackedLink[] {
  ensureDirs();
  if (!existsSync(LINKS_FILE)) return [];
  try {
    const raw = readFileSync(LINKS_FILE, "utf-8");
    const arr = JSON.parse(raw) as TrackedLink[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(links: TrackedLink[]): void {
  ensureDirs();
  writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2), { encoding: "utf-8", mode: 0o600 });
}

/**
 * Generate a short URL-safe code. 6 bytes → 8 base64url chars. Collision odds
 * across realistic single-user volume (thousands of DMs) are negligible, but
 * we still retry on the off-chance of a clash with an existing code.
 */
function mintCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomBytes(6).toString("base64url");
    if (!existing.has(code)) return code;
  }
  // Extremely unlikely fallback — widen the entropy.
  return randomBytes(12).toString("base64url");
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Mint a tracking link for a single DM-send. Returns the persisted record.
 * Call this AFTER a successful send so we don't accumulate orphan links for
 * DMs that never arrived.
 */
export function createLink(input: {
  ruleId: string;
  keyword: string;
  platform: AutoDmPlatform;
  commenterId: string;
  commenterName?: string;
  postId: string;
  targetUrl: string;
  messageId?: string;
}): TrackedLink {
  const links = readAll();
  const existing = new Set(links.map((l) => l.code));
  const link: TrackedLink = {
    code: mintCode(existing),
    ruleId: input.ruleId,
    keyword: input.keyword,
    platform: input.platform,
    commenterId: input.commenterId,
    commenterName: input.commenterName,
    postId: input.postId,
    targetUrl: input.targetUrl,
    messageId: input.messageId,
    createdAt: new Date().toISOString(),
    clicks: [],
  };
  links.push(link);
  writeAll(links);
  return link;
}

/**
 * Pre-mint a code WITHOUT persisting it. Useful when the DM text must contain
 * the link before the send happens — generate the code, build the DM, send,
 * then call `commitLink()` with the same code on success. Returns the code.
 */
export function reserveCode(): string {
  const links = readAll();
  const existing = new Set(links.map((l) => l.code));
  return mintCode(existing);
}

/** Persist a link using a pre-reserved code (see reserveCode). Idempotent on code. */
export function commitLink(
  code: string,
  input: {
    ruleId: string;
    keyword: string;
    platform: AutoDmPlatform;
    commenterId: string;
    commenterName?: string;
    postId: string;
    targetUrl: string;
    messageId?: string;
  },
): TrackedLink {
  const links = readAll();
  const existingIdx = links.findIndex((l) => l.code === code);
  const link: TrackedLink = {
    code,
    ruleId: input.ruleId,
    keyword: input.keyword,
    platform: input.platform,
    commenterId: input.commenterId,
    commenterName: input.commenterName,
    postId: input.postId,
    targetUrl: input.targetUrl,
    messageId: input.messageId,
    createdAt: links[existingIdx]?.createdAt ?? new Date().toISOString(),
    clicks: links[existingIdx]?.clicks ?? [],
  };
  if (existingIdx === -1) links.push(link);
  else links[existingIdx] = link;
  writeAll(links);
  return link;
}

export function resolveLink(code: string): TrackedLink | null {
  return readAll().find((l) => l.code === code) ?? null;
}

/**
 * Record a click on a tracked link. Returns the targetUrl (with UTM params
 * appended) for the redirect, or null if the code is unknown.
 */
export function recordClick(code: string, meta?: { ua?: string; ip?: string }): { targetUrl: string } | null {
  const links = readAll();
  const idx = links.findIndex((l) => l.code === code);
  if (idx === -1) return null;
  links[idx].clicks.push({
    at: new Date().toISOString(),
    ua: meta?.ua ? meta.ua.slice(0, 300) : undefined,
    ip: meta?.ip,
  });
  writeAll(links);
  return { targetUrl: buildRedirectUrl(links[idx]) };
}

/**
 * Append UTM params to the target so Substack's own analytics attributes the
 * visit. Existing query params on the targetUrl are preserved.
 */
export function buildRedirectUrl(link: TrackedLink): string {
  try {
    const url = new URL(link.targetUrl);
    url.searchParams.set("utm_source", link.platform);
    url.searchParams.set("utm_medium", "auto_dm");
    if (link.keyword) url.searchParams.set("utm_campaign", link.keyword.toLowerCase());
    url.searchParams.set("utm_content", link.code);
    return url.toString();
  } catch {
    // Malformed targetUrl — return as-is rather than throwing during a redirect.
    return link.targetUrl;
  }
}

// ─── Funnel Aggregation ────────────────────────────────────────────────────────

export interface RuleFunnel {
  ruleId: string;
  keyword: string;
  /** DM-sends that minted a tracking link (i.e. had {{link}} + a targetUrl). */
  linksSent: number;
  /** Links with ≥1 click. */
  linksClicked: number;
  /** Total clicks across all links (a person may click twice). */
  totalClicks: number;
  /** linksClicked / linksSent, 0..1. Null when linksSent === 0. */
  clickRate: number | null;
  lastClickAt: string | null;
}

export interface FunnelSummary {
  rules: RuleFunnel[];
  totals: {
    linksSent: number;
    linksClicked: number;
    totalClicks: number;
    clickRate: number | null;
  };
}

/**
 * Build the click funnel grouped by rule. Only reflects DMs that carried a
 * tracking link — DMs without a {{link}} placeholder don't appear here (they
 * have no measurable click step). The DM-sent counter on the rule itself
 * (AutoDmRule.sentCount) remains the source of truth for total sends.
 */
export function buildFunnel(): FunnelSummary {
  const links = readAll();
  const byRule = new Map<string, RuleFunnel>();

  for (const l of links) {
    let f = byRule.get(l.ruleId);
    if (!f) {
      f = {
        ruleId: l.ruleId,
        keyword: l.keyword,
        linksSent: 0,
        linksClicked: 0,
        totalClicks: 0,
        clickRate: null,
        lastClickAt: null,
      };
      byRule.set(l.ruleId, f);
    }
    f.linksSent += 1;
    if (l.clicks.length > 0) {
      f.linksClicked += 1;
      f.totalClicks += l.clicks.length;
      const last = l.clicks[l.clicks.length - 1].at;
      if (!f.lastClickAt || last > f.lastClickAt) f.lastClickAt = last;
    }
  }

  const rules = [...byRule.values()].map((f) => ({
    ...f,
    clickRate: f.linksSent > 0 ? f.linksClicked / f.linksSent : null,
  }));
  // Most-recently-active rules first.
  rules.sort((a, b) => (b.lastClickAt ?? "").localeCompare(a.lastClickAt ?? ""));

  const totalSent = rules.reduce((s, r) => s + r.linksSent, 0);
  const totalClicked = rules.reduce((s, r) => s + r.linksClicked, 0);
  const totalClicks = rules.reduce((s, r) => s + r.totalClicks, 0);

  return {
    rules,
    totals: {
      linksSent: totalSent,
      linksClicked: totalClicked,
      totalClicks,
      clickRate: totalSent > 0 ? totalClicked / totalSent : null,
    },
  };
}

/** List all tracked links (newest first), optionally filtered by rule. */
export function listLinks(opts?: { ruleId?: string }): TrackedLink[] {
  let links = readAll();
  if (opts?.ruleId) links = links.filter((l) => l.ruleId === opts.ruleId);
  return links.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Test utility (only for vitest) ──────────────────────────────────────────

export function _resetForTest(): void {
  if (existsSync(LINKS_FILE)) writeAll([]);
}
