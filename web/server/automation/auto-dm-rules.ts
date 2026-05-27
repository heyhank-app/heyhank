// ─── Auto-DM Rules ──────────────────────────────────────────────────────────
// Per-post (or platform-wide) rules that fire an Auto-DM when an incoming
// comment matches a keyword. The rules engine + storage live here; the
// webhook receiver calls `findMatchingRule()` for every parsed comment and
// the send worker is invoked with the resulting rule + comment.
//
// Storage: ~/.heyhank/automation/auto-dm-rules.json (single JSON array).
// Single-user system, low traffic — no need for SQLite here.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HEYHANK_HOME } from "../paths.js";
import type { CommentEvent } from "./meta-webhook.js";

const AUTOMATION_DIR = join(HEYHANK_HOME, "automation");
const RULES_FILE = join(AUTOMATION_DIR, "auto-dm-rules.json");

export type AutoDmPlatform = "instagram" | "facebook";

export interface AutoDmRule {
  id: string;
  /** Platform the rule listens on. Comments from other platforms are ignored. */
  platform: AutoDmPlatform;
  /**
   * If set, only comments on this specific post fire the rule. If null/undefined,
   * the rule applies to ALL posts on the platform — useful for evergreen
   * "comment 'PROMPTS' on any post"-style triggers.
   */
  postId?: string | null;
  /** Case-insensitive substring the comment text must contain. */
  keyword: string;
  /** The DM body sent via the Private-Reply Send API. */
  dmTemplate: string;
  enabled: boolean;
  /** Total successful sends across all triggers (audit). */
  sentCount: number;
  /** Per-(postId, commenterId) dedupe so we never DM the same person twice. */
  sentTo: Array<{ postId: string; commenterId: string; sentAt: string }>;
  createdAt: string;
  updatedAt: string;
  /** Free-text human description (optional, for UI). */
  notes?: string;
}

function ensureDirs(): void {
  if (!existsSync(AUTOMATION_DIR)) mkdirSync(AUTOMATION_DIR, { recursive: true, mode: 0o700 });
}

function readAll(): AutoDmRule[] {
  ensureDirs();
  if (!existsSync(RULES_FILE)) return [];
  try {
    const raw = readFileSync(RULES_FILE, "utf-8");
    const arr = JSON.parse(raw) as AutoDmRule[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(rules: AutoDmRule[]): void {
  ensureDirs();
  writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function listRules(opts?: { platform?: AutoDmPlatform; postId?: string }): AutoDmRule[] {
  let rules = readAll();
  if (opts?.platform) rules = rules.filter((r) => r.platform === opts.platform);
  if (opts?.postId) rules = rules.filter((r) => r.postId === opts.postId);
  return rules;
}

export function getRule(id: string): AutoDmRule | null {
  return readAll().find((r) => r.id === id) ?? null;
}

export function createRule(
  input: Pick<AutoDmRule, "platform" | "keyword" | "dmTemplate"> &
    Partial<Pick<AutoDmRule, "postId" | "enabled" | "notes">>,
): AutoDmRule {
  const now = new Date().toISOString();
  const rule: AutoDmRule = {
    id: randomUUID(),
    platform: input.platform,
    postId: input.postId ?? null,
    keyword: input.keyword.trim(),
    dmTemplate: input.dmTemplate,
    enabled: input.enabled ?? true,
    sentCount: 0,
    sentTo: [],
    createdAt: now,
    updatedAt: now,
    notes: input.notes,
  };
  const rules = readAll();
  rules.push(rule);
  writeAll(rules);
  return rule;
}

export function updateRule(id: string, patch: Partial<Omit<AutoDmRule, "id" | "createdAt">>): AutoDmRule | null {
  const rules = readAll();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  rules[idx] = { ...rules[idx], ...patch, updatedAt: new Date().toISOString() };
  writeAll(rules);
  return rules[idx];
}

export function deleteRule(id: string): boolean {
  const rules = readAll();
  const next = rules.filter((r) => r.id !== id);
  if (next.length === rules.length) return false;
  writeAll(next);
  return true;
}

// ─── Match Engine ────────────────────────────────────────────────────────────

/**
 * Find the first rule that matches a comment event. Returns null if none.
 * Matching order: (a) platform must match, (b) postId scope must match
 * (rule-postId === event.postId OR rule has no postId restriction), (c)
 * comment text must contain the keyword case-insensitively, (d) rule must be
 * enabled, (e) commenter must not already be in `sentTo` for THIS post.
 *
 * Per-rule iteration is O(N) — fine for the realistic single-user volume of
 * 20-200 rules total. If this ever needs to scale, index by (platform, postId).
 */
export function findMatchingRule(event: CommentEvent): AutoDmRule | null {
  const text = event.text.toLowerCase();
  const rules = readAll();
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.platform !== event.platform) continue;
    if (r.postId && r.postId !== event.postId) continue;
    if (!r.keyword || !text.includes(r.keyword.toLowerCase())) continue;
    // Dedupe: same commenter + same post → skip (we already DM'd them).
    if (r.sentTo.some((s) => s.postId === event.postId && s.commenterId === event.commenterId)) continue;
    return r;
  }
  return null;
}

/** Record that we sent a DM for this rule + comment. Updates counters. */
export function recordSend(ruleId: string, event: CommentEvent): AutoDmRule | null {
  const rules = readAll();
  const idx = rules.findIndex((r) => r.id === ruleId);
  if (idx === -1) return null;
  rules[idx].sentTo.push({
    postId: event.postId,
    commenterId: event.commenterId,
    sentAt: new Date().toISOString(),
  });
  rules[idx].sentCount = (rules[idx].sentCount ?? 0) + 1;
  rules[idx].updatedAt = new Date().toISOString();
  writeAll(rules);
  return rules[idx];
}

// ─── Test utility (only for vitest) ──────────────────────────────────────────

export function _resetForTest(): void {
  if (existsSync(RULES_FILE)) writeAll([]);
}
