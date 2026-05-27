// ─── Meta App Secrets ───────────────────────────────────────────────────────
// Persists the Meta App credentials that the Auto-DM webhook receiver + send
// worker need. Kept in its own file (mode 0o600) under HEYHANK_HOME so it
// doesn't accidentally land in the shared socialmedia/settings.json that the
// content agent reads.
//
// Six fields, all sourced from the Meta App dashboard:
//   - appId           — the App ID (also called Client ID), public
//   - appSecret       — used to verify X-Hub-Signature-256 on incoming webhooks
//   - pageId          — your Facebook Page ID
//   - igBusinessId    — your Instagram Business Account ID (linked to the Page)
//   - pageAccessToken — long-lived Page-Access-Token (used for Send API + comments API)
//   - webhookVerify   — the verify-token you typed into the Meta webhook config

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "../paths.js";

const AUTOMATION_DIR = join(HEYHANK_HOME, "automation");
const SECRETS_FILE = join(AUTOMATION_DIR, "meta-secrets.json");

export interface MetaSecrets {
  // ─── Instagram side (graph.instagram.com / Instagram Business Login Direct) ──
  /** Instagram-product child App ID (e.g. 1206785405842211). */
  appId: string;
  /** Instagram-product child App Secret. Used to verify webhook signatures
   *  on payloads with `object: "instagram"`. */
  appSecret: string;
  igBusinessId: string;
  /**
   * Long-lived Instagram User Access Token from the Instagram Business Login
   * Direct OAuth flow. Required for the new graph.instagram.com endpoints
   * (subscribed_apps, /me/messages with IGSID recipients, etc).
   */
  userAccessToken: string;
  /** Unix-ms when the userAccessToken expires. 60 days from last refresh. */
  userTokenExpiresAt: number;
  /** Numeric IG User ID that the user-access-token belongs to. */
  igUserId: string;

  // ─── Facebook side (graph.facebook.com / Facebook Page) ─────────────────────
  /** Parent App ID that the FB Pages use case lives in (e.g. 909156382186050). */
  fbAppId: string;
  /** Parent App Secret. Used to verify webhook signatures on payloads with
   *  `object: "page"`. May equal `appSecret` if a single App is used for both. */
  fbAppSecret: string;
  /** Facebook Page ID the Auto-DM rules apply to. */
  pageId: string;
  /**
   * System-User Page Access Token (permanent, never expires) with the Page
   * scopes: pages_messaging, pages_read_engagement, pages_manage_metadata,
   * pages_show_list. Used to subscribe the Page to webhook fields and to
   * send Private Reply DMs on FB.
   */
  pageAccessToken: string;
  /**
   * Long-lived Facebook User Access Token from the Facebook Login for Business
   * OAuth flow. Required for /me/accounts (list pages the user manages) +
   * other user-context endpoints that the System-User Page Token can't reach.
   * Renewed via the OAuth re-grant flow whenever it expires (60d).
   */
  fbUserAccessToken: string;
  /** Unix-ms when the fbUserAccessToken expires (typically issued_at + 60d). */
  fbUserTokenExpiresAt: number;

  // ─── Shared ─────────────────────────────────────────────────────────────────
  webhookVerify: string;
}

const EMPTY: MetaSecrets = {
  appId: "",
  appSecret: "",
  igBusinessId: "",
  userAccessToken: "",
  userTokenExpiresAt: 0,
  igUserId: "",
  fbAppId: "",
  fbAppSecret: "",
  pageId: "",
  pageAccessToken: "",
  fbUserAccessToken: "",
  fbUserTokenExpiresAt: 0,
  webhookVerify: "",
};

function ensureDirs(): void {
  if (!existsSync(AUTOMATION_DIR)) mkdirSync(AUTOMATION_DIR, { recursive: true, mode: 0o700 });
}

/** Read the stored Meta secrets. Returns empty values if no file exists yet. */
export function getMetaSecrets(): MetaSecrets {
  ensureDirs();
  if (!existsSync(SECRETS_FILE)) return { ...EMPTY };
  try {
    const raw = readFileSync(SECRETS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MetaSecrets>;
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

/** Persist Meta secrets to disk with strict permissions. */
export function saveMetaSecrets(secrets: Partial<MetaSecrets>): MetaSecrets {
  ensureDirs();
  const merged = { ...getMetaSecrets(), ...secrets };
  writeFileSync(SECRETS_FILE, JSON.stringify(merged, null, 2), { encoding: "utf-8", mode: 0o600 });
  return merged;
}

/**
 * Exchange an OAuth `code` (from the Instagram Business Login redirect) for a
 * long-lived user access token. Two-step Meta flow:
 *   1. POST api.instagram.com/oauth/access_token   → short-lived token (~1h)
 *   2. GET  graph.instagram.com/access_token       → long-lived token (60d)
 *
 * On success persists the long-lived token + igUserId + expiry into secrets.
 * Returns a {ok, error?} struct so callers can show a friendly UI message.
 */
export async function exchangeOAuthCode(
  code: string,
  redirectUri: string,
): Promise<{ ok: boolean; error?: string; igUserId?: string; expiresAt?: number }> {
  const s = getMetaSecrets();
  if (!s.appId || !s.appSecret) {
    return { ok: false, error: "appId/appSecret not configured" };
  }

  // Step 1: short-lived
  const shortForm = new URLSearchParams({
    client_id: s.appId,
    client_secret: s.appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  try {
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: shortForm,
    });
    const shortText = await shortRes.text();
    if (!shortRes.ok) {
      return { ok: false, error: `short-lived exchange failed: HTTP ${shortRes.status} ${shortText.slice(0, 200)}` };
    }
    const shortJson = JSON.parse(shortText) as { access_token?: string; user_id?: number | string };
    if (!shortJson.access_token) {
      return { ok: false, error: "short-lived response missing access_token" };
    }
    const igUserId = String(shortJson.user_id ?? "");

    // Step 2: long-lived
    const longUrl =
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token` +
      `&client_secret=${encodeURIComponent(s.appSecret)}` +
      `&access_token=${encodeURIComponent(shortJson.access_token)}`;
    const longRes = await fetch(longUrl);
    const longText = await longRes.text();
    if (!longRes.ok) {
      return { ok: false, error: `long-lived exchange failed: HTTP ${longRes.status} ${longText.slice(0, 200)}` };
    }
    const longJson = JSON.parse(longText) as { access_token?: string; expires_in?: number };
    if (!longJson.access_token) {
      return { ok: false, error: "long-lived response missing access_token" };
    }
    const expiresAt = Date.now() + ((longJson.expires_in ?? 5_184_000) * 1000);

    saveMetaSecrets({
      userAccessToken: longJson.access_token,
      userTokenExpiresAt: expiresAt,
      igUserId,
    });
    return { ok: true, igUserId, expiresAt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Exchange an OAuth `code` from the Facebook Login for Business flow for a
 * long-lived FB User Access Token (60 days). Different endpoint than the IG
 * flow because FB pages live under graph.facebook.com, not the IG-direct
 * domain. On success persists fbUserAccessToken + fbUserTokenExpiresAt.
 *
 * Returns {ok, error?} so the callback can render a friendly page.
 */
export async function exchangeFbOAuthCode(
  code: string,
  redirectUri: string,
): Promise<{ ok: boolean; error?: string; expiresAt?: number }> {
  const s = getMetaSecrets();
  // Facebook Login for Business uses the Parent-App credentials (fbAppId/
  // fbAppSecret), not the Instagram child App (appId/appSecret).
  const fbAppId = s.fbAppId || s.appId;
  const fbAppSecret = s.fbAppSecret || s.appSecret;
  if (!fbAppId || !fbAppSecret) {
    return { ok: false, error: "fbAppId/fbAppSecret not configured" };
  }

  // Step 1: code → short-lived user access token
  const url =
    `https://graph.facebook.com/v21.0/oauth/access_token` +
    `?client_id=${encodeURIComponent(fbAppId)}` +
    `&client_secret=${encodeURIComponent(fbAppSecret)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${encodeURIComponent(code)}`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `code exchange failed: HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      return { ok: false, error: "exchange response missing access_token" };
    }
    const shortToken = json.access_token;
    let longToken = shortToken;
    let expiresIn = json.expires_in ?? 0;

    // Step 2: short-lived → long-lived (60d). Some FB flows already return a
    // long-lived token; we always attempt the exchange and use whichever has
    // the longer TTL. If exchange fails we fall back to the short token.
    try {
      const longUrl =
        `https://graph.facebook.com/v21.0/oauth/access_token` +
        `?grant_type=fb_exchange_token` +
        `&client_id=${encodeURIComponent(fbAppId)}` +
        `&client_secret=${encodeURIComponent(fbAppSecret)}` +
        `&fb_exchange_token=${encodeURIComponent(shortToken)}`;
      const longRes = await fetch(longUrl);
      const longText = await longRes.text();
      if (longRes.ok) {
        const longJson = JSON.parse(longText) as { access_token?: string; expires_in?: number };
        if (longJson.access_token) {
          longToken = longJson.access_token;
          expiresIn = longJson.expires_in ?? 5_184_000;
        }
      }
    } catch {
      // Fall through with the short-lived token if step 2 fails.
    }

    const expiresAt = Date.now() + expiresIn * 1000;
    saveMetaSecrets({ fbUserAccessToken: longToken, fbUserTokenExpiresAt: expiresAt });
    return { ok: true, expiresAt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Convenience: true iff all six fields are populated (= ready to use). */
export function metaIsConfigured(): boolean {
  const s = getMetaSecrets();
  return Boolean(
    s.appId.trim() &&
    s.appSecret.trim() &&
    s.pageId.trim() &&
    s.igBusinessId.trim() &&
    s.pageAccessToken.trim() &&
    s.webhookVerify.trim(),
  );
}
