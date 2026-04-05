// ─── Web Push Notifications ──────────────────────────────────────────────────
// VAPID-based push notifications for agent alerts

import webpush from "web-push";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VAPID_FILE = join(HEYHANK_HOME, "vapid-keys.json");
const SUBSCRIPTIONS_FILE = join(HEYHANK_HOME, "push-subscriptions.json");

// ─── VAPID Key Management ────────────────────────────────────────────────────

let vapidKeys: VapidKeys | null = null;

function loadOrGenerateVapidKeys(): VapidKeys {
  if (vapidKeys) return vapidKeys;

  try {
    if (existsSync(VAPID_FILE)) {
      const raw = readFileSync(VAPID_FILE, "utf-8");
      vapidKeys = JSON.parse(raw) as VapidKeys;
      webpush.setVapidDetails(
        "mailto:maxx.stoeger@icloud.com",
        vapidKeys.publicKey,
        vapidKeys.privateKey,
      );
      console.log("[push] Loaded existing VAPID keys from disk");
      return vapidKeys;
    }
  } catch {
    // Generate new keys
  }

  // Generate proper ECDSA P-256 VAPID keys using web-push
  const generated = webpush.generateVAPIDKeys();
  const keys: VapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
  };

  try {
    mkdirSync(dirname(VAPID_FILE), { recursive: true });
    writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("[push] Failed to persist VAPID keys:", err);
  }

  webpush.setVapidDetails(
    "mailto:maxx.stoeger@icloud.com",
    keys.publicKey,
    keys.privateKey,
  );

  vapidKeys = keys;
  console.log("[push] Generated new VAPID keys");
  return keys;
}

/** Get the public VAPID key (for browser subscription). */
export function getPublicVapidKey(): string {
  return loadOrGenerateVapidKeys().publicKey;
}

// ─── Subscription Management ─────────────────────────────────────────────────

let subscriptions: PushSubscriptionData[] = [];

function loadSubscriptions(): void {
  try {
    if (existsSync(SUBSCRIPTIONS_FILE)) {
      const raw = readFileSync(SUBSCRIPTIONS_FILE, "utf-8");
      subscriptions = JSON.parse(raw);
    }
  } catch {
    subscriptions = [];
  }
}

function saveSubscriptions(): void {
  try {
    mkdirSync(dirname(SUBSCRIPTIONS_FILE), { recursive: true });
    writeFileSync(
      SUBSCRIPTIONS_FILE,
      JSON.stringify(subscriptions, null, 2),
      "utf-8",
    );
  } catch (err) {
    console.error("[push] Failed to save subscriptions:", err);
  }
}

/** Add a push subscription. */
export function addSubscription(sub: PushSubscriptionData): void {
  // Deduplicate by endpoint
  subscriptions = subscriptions.filter((s) => s.endpoint !== sub.endpoint);
  subscriptions.push(sub);
  saveSubscriptions();
  console.log(`[push] Subscription added (total: ${subscriptions.length})`);
}

/** Remove all subscriptions. */
export function clearSubscriptions(): void {
  subscriptions = [];
  saveSubscriptions();
}

/** Get subscription count. */
export function getSubscriptionCount(): number {
  return subscriptions.length;
}

// ─── Send Notifications ──────────────────────────────────────────────────────

/**
 * Send a push notification to all subscribed browsers.
 * Uses the web-push library for proper VAPID-signed Web Push protocol.
 */
export async function sendNotification(
  title: string,
  body: string,
  options?: {
    icon?: string;
    badge?: string;
    tag?: string;
    url?: string;
    data?: Record<string, unknown>;
  },
): Promise<{ sent: number; failed: number }> {
  const payload = JSON.stringify({
    title,
    body,
    icon: options?.icon || "/icon-192.png",
    badge: options?.badge || "/icon-192.png",
    tag: options?.tag,
    data: {
      url: options?.url || "/",
      ...options?.data,
    },
  });

  let sent = 0;
  let failed = 0;
  const failedEndpoints: string[] = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
        },
        payload,
        { TTL: 86400 },
      );
      sent++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        // Gone or Not Found — subscription expired
        failedEndpoints.push(sub.endpoint);
      }
      failed++;
    }
  }

  // Remove expired subscriptions
  if (failedEndpoints.length > 0) {
    subscriptions = subscriptions.filter(
      (s) => !failedEndpoints.includes(s.endpoint),
    );
    saveSubscriptions();
  }

  return { sent, failed };
}

/** Send an agent alert notification. */
export async function notifyAgentAlert(
  agentName: string,
  message: string,
  severity: "info" | "warning" | "error" = "info",
): Promise<void> {
  const icons: Record<string, string> = {
    info: "\u2139\uFE0F",
    warning: "\u26A0\uFE0F",
    error: "\uD83D\uDEA8",
  };
  await sendNotification(
    `${icons[severity]} ${agentName}`,
    message,
    { tag: `agent-${agentName}` },
  );
}

// ─── Initialize ──────────────────────────────────────────────────────────────

loadSubscriptions();
loadOrGenerateVapidKeys();
