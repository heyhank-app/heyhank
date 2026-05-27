// ─── Meta Send-Worker ───────────────────────────────────────────────────────
// Wraps the Meta Graph "Send API" Private-Reply pattern. Given an incoming
// comment (CommentEvent) and a DM template, posts a private reply to the
// commenter via:
//
//   POST https://graph.facebook.com/v21.0/me/messages
//   {
//     "recipient":  { "comment_id": "<commentId>" },
//     "message":    { "text": "<dmTemplate>" },
//     "messaging_type": "RESPONSE"
//   }
//
// Auth: ?access_token=<pageAccessToken>  (a Page-Access-Token, NOT a user token).
//
// Restriction: The Private-Reply window is 7 days from comment creation. After
// that, Meta returns error code 100/200 — we surface that as a clean error so
// the rules engine can record it and not retry.

import { getMetaSecrets } from "./meta-secrets.js";
import type { CommentEvent } from "./meta-webhook.js";

const GRAPH_VERSION = "v21.0";
const GRAPH_FB_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const GRAPH_IG_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  /** Original raw response — useful for debugging the audit log. */
  raw?: unknown;
}

/**
 * Send a Private-Reply DM in response to a comment.
 *
 * The Graph endpoint behaves slightly differently between Facebook Page
 * comments and Instagram media comments, but the request shape is identical
 * because we identify the recipient via `comment_id` (Meta routes it
 * automatically). We do not need to know whether the comment is on FB or IG.
 */
export async function sendPrivateReply(args: {
  event: CommentEvent;
  dmTemplate: string;
}): Promise<SendResult> {
  const { event, dmTemplate } = args;
  const secrets = getMetaSecrets();

  // Route per platform. Instagram uses graph.instagram.com + the long-lived
  // user-access-token from the Instagram Business Login Direct OAuth flow.
  // Facebook uses graph.facebook.com + the System-User Page Access Token
  // with the pages_messaging scope. The two tokens are NOT interchangeable
  // — Meta keys them to separate App contexts.
  let token: string;
  let base: string;
  if (event.platform === "instagram") {
    token = secrets.userAccessToken;
    base = GRAPH_IG_BASE;
    if (!token) return { ok: false, error: "no userAccessToken configured for Instagram (run OAuth flow first)" };
  } else {
    token = secrets.pageAccessToken;
    base = GRAPH_FB_BASE;
    if (!token) return { ok: false, error: "no pageAccessToken configured for Facebook (generate System-User Page Token)" };
  }

  const url = `${base}/me/messages?access_token=${encodeURIComponent(token)}`;
  const body = {
    recipient: { comment_id: event.commentId },
    message: { text: dmTemplate },
    messaging_type: "RESPONSE",
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    if (!res.ok) {
      const errMsg = extractGraphError(parsed) ?? `HTTP ${res.status}`;
      return { ok: false, error: errMsg, raw: parsed };
    }

    const messageId =
      typeof parsed === "object" && parsed && "message_id" in parsed
        ? String((parsed as { message_id: string }).message_id)
        : undefined;
    return { ok: true, messageId, raw: parsed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Pull `error.message` (or `error.error_user_msg`) out of a Graph error response. */
function extractGraphError(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const err = (parsed as { error?: Record<string, unknown> }).error;
  if (!err) return null;
  const msg = err.error_user_msg ?? err.message;
  return typeof msg === "string" ? msg : null;
}
