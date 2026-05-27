// ─── Meta Webhook Receiver ──────────────────────────────────────────────────
// Parses + verifies incoming Meta webhook events. Meta posts a single payload
// for both Instagram and Facebook subscriptions; per-event handlers convert
// the raw shape into a normalized `CommentEvent` that the Rules-Engine
// matches against.
//
// Security: every POST carries an `X-Hub-Signature-256` header of the form
// `sha256=<hex>`. The hash is HMAC-SHA256(rawBody, appSecret). We reject any
// request whose signature doesn't verify so attackers can't fabricate
// fake-comment events that trigger our Send API.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Normalized shape we hand to the rules engine for matching. */
export interface CommentEvent {
  platform: "instagram" | "facebook";
  /** The post (Page-Post or IG Media) the comment is on. */
  postId: string;
  /** The comment itself. Used as the recipient of Private-Reply DMs. */
  commentId: string;
  /** The author of the comment (Page-Scoped-ID or IGSID). */
  commenterId: string;
  /** Display name (may be missing on FB anonymized commenters). */
  commenterName?: string;
  /** Raw text of the comment. */
  text: string;
  /** Unix ms timestamp from the event, or now() if absent. */
  receivedAt: number;
}

/**
 * Verify the `X-Hub-Signature-256` header against the raw request body.
 * The header has the form `sha256=<hex>`. Returns false on any malformed
 * input rather than throwing — callers reject with 403.
 */
export function verifyMetaSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!m) return false;
  const provided = Buffer.from(m[1], "hex");
  const expected = createHmac("sha256", appSecret)
    .update(typeof rawBody === "string" ? rawBody : rawBody)
    .digest();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

// Raw Meta payload shapes ─ trimmed to the fields we read. Meta ships many
// more keys; we ignore them rather than typing the full schema.
interface RawMetaPayload {
  object?: "page" | "instagram";
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{
      field?: string;
      value?: Record<string, unknown>;
    }>;
  }>;
}

/**
 * Walk a Meta webhook payload and yield one `CommentEvent` per comment-add
 * event it contains. Non-comment changes (likes, status updates, edited
 * comments, deleted comments) are skipped — we only care about NEW comments
 * that could match an Auto-DM rule.
 */
export function extractCommentEvents(payload: unknown): CommentEvent[] {
  const out: CommentEvent[] = [];
  const data = payload as RawMetaPayload;
  if (!data || !Array.isArray(data.entry)) return out;

  const platform: "instagram" | "facebook" = data.object === "instagram" ? "instagram" : "facebook";

  for (const entry of data.entry) {
    if (!Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      // Two flavors arrive for new comments:
      //   - Facebook page subscription: field="feed", value.item="comment", value.verb="add"
      //   - Instagram subscription: field="comments" with the comment payload directly
      if (platform === "facebook" && change.field === "feed") {
        const v = change.value ?? {};
        if (v.item !== "comment" || v.verb !== "add") continue;
        const commentId = String(v.comment_id ?? "");
        const postId = String(v.post_id ?? "");
        const commenterId = String((v.from as { id?: unknown } | undefined)?.id ?? "");
        const commenterName = typeof (v.from as { name?: unknown } | undefined)?.name === "string"
          ? String((v.from as { name: string }).name)
          : undefined;
        const text = String(v.message ?? "");
        if (!commentId || !postId || !commenterId) continue;
        out.push({
          platform,
          postId,
          commentId,
          commenterId,
          commenterName,
          text,
          receivedAt: typeof entry.time === "number" ? entry.time * 1000 : Date.now(),
        });
      } else if (platform === "instagram" && change.field === "comments") {
        const v = change.value ?? {};
        const commentId = String(v.id ?? "");
        const postId = String((v.media as { id?: unknown } | undefined)?.id ?? "");
        const commenterId = String((v.from as { id?: unknown } | undefined)?.id ?? "");
        const commenterName = typeof (v.from as { username?: unknown } | undefined)?.username === "string"
          ? String((v.from as { username: string }).username)
          : undefined;
        const text = String(v.text ?? "");
        if (!commentId || !postId || !commenterId) continue;
        out.push({
          platform,
          postId,
          commentId,
          commenterId,
          commenterName,
          text,
          receivedAt: typeof entry.time === "number" ? entry.time * 1000 : Date.now(),
        });
      }
    }
  }
  return out;
}
