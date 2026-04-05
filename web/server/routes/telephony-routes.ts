// ─── Telephony Routes ─────────────────────────────────────────────────────────
// REST API for managing phone calls via FreeSWITCH + Gemini Live.

import type { Hono } from "hono";
import { callManager } from "../telephony/call-manager.js";
import * as store from "../telephony/telephony-store.js";
import type { CallConfig, SipTrunkConfig } from "../telephony/call-types.js";
import { randomUUID } from "node:crypto";

export function registerTelephonyRoutes(api: Hono): void {
  // ─── Calls ───────────────────────────────────────────────────────────

  /** Start a new outbound call */
  api.post("/telephony/calls", async (c) => {
    try {
      const body = await c.req.json() as CallConfig;

      if (!body.phone) {
        return c.json({ error: "phone is required (E.164 format, e.g. +4366412345)" }, 400);
      }
      if (!body.prompt) {
        return c.json({ error: "prompt is required (task for the AI)" }, 400);
      }

      // Normalize phone number
      let phone = body.phone.replace(/\s/g, "");
      if (!phone.startsWith("+")) {
        // Assume Austrian number if no country code
        if (phone.startsWith("0")) phone = "+43" + phone.slice(1);
        else phone = "+" + phone;
      }

      const callState = await callManager.startCall({
        ...body,
        phone,
      });

      return c.json(callState);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start call";
      return c.json({ error: msg }, 500);
    }
  });

  /** List active calls */
  api.get("/telephony/calls", (c) => {
    const active = callManager.getActiveCalls();
    return c.json({ calls: active });
  });

  /** Get call details (active or from history) */
  api.get("/telephony/calls/:id", (c) => {
    const id = c.req.param("id");
    const active = callManager.getCallState(id);
    if (active) return c.json(active);

    const stored = store.getCall(id);
    if (stored) return c.json(stored);

    return c.json({ error: "Call not found" }, 404);
  });

  /** End/hangup an active call */
  api.delete("/telephony/calls/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const result = await callManager.endCall(id);
      if (!result) return c.json({ error: "Call not found or already ended" }, 404);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to end call" }, 500);
    }
  });

  /** Call history */
  api.get("/telephony/history", (c) => {
    const limit = parseInt(c.req.query("limit") || "50", 10);
    const calls = store.listCalls(limit);
    return c.json({ calls });
  });

  // ─── Settings ────────────────────────────────────────────────────────

  /** Get telephony settings */
  api.get("/telephony/settings", (c) => {
    const settings = store.getSettings();
    // Don't expose passwords in API response
    const safe = {
      ...settings,
      freeswitch: {
        ...settings.freeswitch,
        eslPassword: settings.freeswitch.eslPassword ? "***" : "",
      },
      trunks: settings.trunks.map((t) => ({
        ...t,
        password: t.password ? "***" : "",
      })),
    };
    return c.json(safe);
  });

  /** Update telephony settings */
  api.put("/telephony/settings", async (c) => {
    try {
      const body = await c.req.json();
      const current = store.getSettings();

      // Merge settings, preserving passwords if masked
      const updated = { ...current, ...body };

      // Restore passwords if they come back as "***"
      if (updated.freeswitch?.eslPassword === "***") {
        updated.freeswitch.eslPassword = current.freeswitch.eslPassword;
      }
      if (updated.trunks) {
        updated.trunks = updated.trunks.map((t: SipTrunkConfig, i: number) => {
          if (t.password === "***" && current.trunks[i]) {
            return { ...t, password: current.trunks[i].password };
          }
          return t;
        });
      }

      store.saveSettings(updated);
      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to save settings" }, 500);
    }
  });

  // ─── SIP Trunks ──────────────────────────────────────────────────────

  /** Add a SIP trunk */
  api.post("/telephony/trunks", async (c) => {
    try {
      const body = await c.req.json() as Omit<SipTrunkConfig, "id">;
      if (!body.name || !body.username || !body.password || !body.server) {
        return c.json({ error: "name, username, password, and server are required" }, 400);
      }

      const settings = store.getSettings();
      const trunk: SipTrunkConfig = {
        ...body,
        id: randomUUID(),
        enabled: body.enabled ?? true,
      };
      settings.trunks.push(trunk);
      if (!settings.defaultTrunkId) settings.defaultTrunkId = trunk.id;
      store.saveSettings(settings);

      return c.json(trunk);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to add trunk" }, 500);
    }
  });

  /** Remove a SIP trunk */
  api.delete("/telephony/trunks/:id", (c) => {
    const id = c.req.param("id");
    const settings = store.getSettings();
    settings.trunks = settings.trunks.filter((t) => t.id !== id);
    if (settings.defaultTrunkId === id) {
      settings.defaultTrunkId = settings.trunks[0]?.id || null;
    }
    store.saveSettings(settings);
    return c.json({ success: true });
  });

  /** Test FreeSWITCH ESL connection */
  api.post("/telephony/test-connection", async (c) => {
    const settings = store.getSettings();
    const { eslHost, eslPort, eslPassword } = settings.freeswitch;

    try {
      const eslUrl = `http://${eslHost}:${eslPort}/api`;
      const res = await fetch(eslUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Authorization": `Basic ${btoa(`freeswitch:${eslPassword}`)}`,
        },
        body: "status",
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const text = await res.text();
        return c.json({ connected: true, status: text.trim().slice(0, 200) });
      }
      return c.json({ connected: false, error: `HTTP ${res.status}` });
    } catch (err) {
      return c.json({
        connected: false,
        error: err instanceof Error ? err.message : "Connection failed",
      });
    }
  });
}
