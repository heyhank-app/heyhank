/**
 * Service Worker registration for production builds.
 *
 * Uses vite-plugin-pwa's autoUpdate mode: when a new SW is detected,
 * it downloads, installs, and activates immediately (skipWaiting + clientsClaim).
 *
 * In dev mode the virtual:pwa-register module is a no-op, so importing
 * this file has no effect during development.
 *
 * Edge cases:
 * - Multiple tabs: skipWaiting activates the new SW across all tabs immediately.
 *   WebSocket connections are unaffected (SW never intercepts /ws/* routes).
 * - First-time visitors: app loads from network; SW installs in background.
 * - SW update during active session: only static assets are cached. API calls
 *   and WebSocket connections go directly to network.
 */
import { registerSW } from "virtual:pwa-register";

let swRegistration: ServiceWorkerRegistration | undefined;

registerSW({
  onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
    swRegistration = registration;
    if (registration) {
      // Check for SW updates every 60 seconds while the app is open.
      setInterval(() => {
        registration.update();
      }, 60 * 1000);

      // Also check immediately on page visibility change (user returns to tab)
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update();
        }
      });

      // When a new SW is waiting, force it to activate and reload the page
      // so users always get the latest code without manual hard-refresh.
      const promptReload = () => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
          window.location.reload();
        }
      };
      if (registration.waiting) promptReload();
      registration.addEventListener("updatefound", () => {
        const newSW = registration.installing;
        if (newSW) {
          newSW.addEventListener("statechange", () => {
            if (newSW.state === "installed" && navigator.serviceWorker.controller) {
              promptReload();
            }
          });
        }
      });
    }
  },
  onOfflineReady() {
    console.log("[SW] Offline-ready: all assets precached");
  },
});

/**
 * Convert a URL-safe base64 string to a Uint8Array for applicationServerKey.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribe the browser to push notifications.
 * Fetches the VAPID public key from the server, creates a push subscription,
 * and sends it to the server.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  const registration = swRegistration ?? (await navigator.serviceWorker?.ready);
  if (!registration) {
    console.warn("[push] No service worker registration available");
    return null;
  }

  // Check if already subscribed
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    console.log("[push] Already subscribed to push notifications");
    return existing;
  }

  // Fetch the VAPID public key from the server
  const resp = await fetch("/api/push/vapid-key");
  if (!resp.ok) {
    console.error("[push] Failed to fetch VAPID key:", resp.status);
    return null;
  }
  const { publicKey: key } = (await resp.json()) as { publicKey: string };

  // Subscribe to push
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  });

  // Send subscription to server
  const subResp = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });

  if (!subResp.ok) {
    console.error("[push] Failed to send subscription to server:", subResp.status);
  } else {
    console.log("[push] Successfully subscribed to push notifications");
  }

  return subscription;
}

/**
 * Unsubscribe the browser from push notifications.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  const registration = swRegistration ?? (await navigator.serviceWorker?.ready);
  if (!registration) {
    return false;
  }

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return true; // Already unsubscribed
  }

  const success = await subscription.unsubscribe();
  if (success) {
    console.log("[push] Successfully unsubscribed from push notifications");
  }
  return success;
}
