// ─── Auto-Rule Hook ─────────────────────────────────────────────────────────
// When a social post is published or scheduled on IG/FB with a `Comment XXX`
// trigger in the body and a non-empty firstComment, auto-create a matching
// Auto-DM rule so the funnel runs without the user having to set it up by
// hand. This is the bridge between the Content Agent's "Comment WORD" CTA
// pattern and the Auto-DM rules engine.
//
// Triggered from the socialmedia manager's createPost + publishDraft paths.

import { createRule, listRules, type AutoDmPlatform } from "../automation/auto-dm-rules.js";
import type { SocialPost, SocialPlatform } from "./types.js";

// Two-stage match: the verb "Comment" is matched case-insensitively, but the
// captured KEYWORD must be all-caps (3-20 chars). The case-insensitive `i`
// flag would otherwise let "Comment below" match — "Below" starts with B and
// the rest would get folded by /i — so we keep the keyword pattern strict.
const COMMENT_PREFIX_RE = /comment\s+["'„""]?/i;
const KEYWORD_RE = /^[A-Z][A-Z0-9_-]{2,19}\b/;

/** Pull the trigger keyword out of a post body, or null if none. */
export function extractCommentTrigger(text: string): string | null {
  if (!text) return null;
  const m = text.match(COMMENT_PREFIX_RE);
  if (!m || m.index === undefined) return null;
  const rest = text.slice(m.index + m[0].length);
  const kw = rest.match(KEYWORD_RE);
  return kw ? kw[0] : null;
}

const SUPPORTED: AutoDmPlatform[] = ["instagram", "facebook"];

function isAutoDmPlatform(p: SocialPlatform): p is AutoDmPlatform {
  return p === "instagram" || p === "facebook";
}

/**
 * Side-effect: best-effort auto-create Auto-DM rules for the published post.
 * No-ops if any of: no firstComment / no IG-or-FB platform / no Comment trigger /
 * rule with same (platform, postId, keyword) already exists. Errors are
 * swallowed — the publish flow must not fail just because rule creation hit
 * a corner case.
 */
export function autoCreateRulesForPost(post: SocialPost): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];

  if (!post.firstComment?.trim()) {
    return { created, skipped: ["no firstComment"] };
  }
  if (post.isAutoDmRuleSkipped) {
    return { created, skipped: ["explicitly skipped"] };
  }

  const keyword = extractCommentTrigger(post.text);
  if (!keyword) {
    return { created, skipped: ["no Comment trigger keyword in body"] };
  }

  const platforms = (post.platforms ?? []).filter(isAutoDmPlatform);
  if (platforms.length === 0) {
    return { created, skipped: ["no IG/FB platform on post"] };
  }

  // We need the backend's post-id to scope the rule. Without it the rule
  // would fire on EVERY post (post-wide evergreen), which is rarely what
  // the user wants for a one-off lead-magnet. Fall back to evergreen-null
  // ONLY when there's no backend id yet (e.g. draft, manual posting).
  const postId = extractPostIdForRule(post);

  for (const platform of platforms) {
    // Dedupe: same platform + same postId-scope + same keyword → skip.
    const existing = listRules({ platform }).find(
      (r) => r.keyword.toUpperCase() === keyword && (r.postId ?? null) === (postId ?? null),
    );
    if (existing) {
      skipped.push(`${platform}: rule already exists (${existing.id})`);
      continue;
    }

    const rule = createRule({
      platform,
      postId,
      keyword,
      dmTemplate: post.firstComment,
      notes: `auto-created from post ${post.id}`,
    });
    created.push(`${platform}: ${rule.id}`);
  }

  return { created, skipped };
}

/**
 * Pull the platform-specific post-id out of `backendData`. The shape was
 * stamped by the multi-backend createPost in manager.ts — each group writes
 * `{ platforms, status, id, data }` keyed by the backend identifier.
 * Returns null when no backend has acked yet (= still a local draft).
 */
function extractPostIdForRule(post: SocialPost): string | null {
  if (post.backendData && typeof post.backendData === "object") {
    const bd = post.backendData as Record<string, { id?: string }>;
    // Prefer the first non-null id we find. Order doesn't matter for matching
    // because Meta will deliver comment-webhooks with that ID anyway.
    for (const key of Object.keys(bd)) {
      const id = bd[key]?.id;
      if (id) return id;
    }
  }
  return post.backendPostId ?? null;
}
