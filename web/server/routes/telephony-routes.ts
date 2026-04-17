// ─── Telephony Routes ─────────────────────────────────────────────────────────
// REST API for managing phone calls via FreeSWITCH + Gemini Live.

import type { Hono } from "hono";
import { callManager } from "../telephony/call-manager.js";
import * as store from "../telephony/telephony-store.js";
import type { CallConfig, SipTrunkConfig, TelephonyContact } from "../telephony/call-types.js";
import { eslCommand, eslStatus } from "../telephony/esl-client.js";
import { syncAndReload, checkGatewayStatus } from "../telephony/freeswitch-sync.js";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getPipelineSettingsFrom } from "../voice-pipeline/manager.js";
import { preRenderAllGreetings, clearCache } from "../voice-pipeline/greeting-cache.js";

/**
 * Background-warm the greeting cache so the first call has 0ms TTS latency.
 * Fire-and-forget — failures are logged but don't block the calling endpoint.
 */
function warmGreetingsAsync(opts: { clearFirst?: boolean } = {}): void {
  setImmediate(async () => {
    try {
      const settings = store.getSettings();
      const pipelineSettings = getPipelineSettingsFrom(settings);
      if (!pipelineSettings.enabled || !pipelineSettings.preRenderGreetings) return;
      if (opts.clearFirst) clearCache();
      const stats = await preRenderAllGreetings(settings.contacts, pipelineSettings);
      console.log(`[telephony] Greeting cache warmed: ${stats.rendered} rendered, ${stats.cached} cached, ${stats.errors} errors`);
    } catch (e) {
      console.error("[telephony] Greeting warm failed:", e);
    }
  });
}

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

  /** Serve call audio recording (WAV) */
  api.get("/telephony/calls/:id/audio", (c) => {
    const id = c.req.param("id");
    // Validate UUID format to prevent path traversal
    if (!/^[a-f0-9-]{36}$/.test(id)) {
      return c.json({ error: "Invalid call ID" }, 400);
    }
    const wavPath = join(homedir(), ".heyhank", "telephony", "calls", `${id}.wav`);
    if (!existsSync(wavPath)) {
      return c.json({ error: "Audio recording not found" }, 404);
    }
    const file = Bun.file(wavPath);
    const stat = statSync(wavPath);
    return new Response(file, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(stat.size),
        "Content-Disposition": `inline; filename="${id}.wav"`,
        "Cache-Control": "private, max-age=86400",
      },
    });
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

      // If voice settings changed, invalidate greeting cache and re-warm
      const oldVoice = getPipelineSettingsFrom(current).tts.voice;
      const newVoice = getPipelineSettingsFrom(updated).tts.voice;
      const voiceChanged = oldVoice !== newVoice;
      warmGreetingsAsync({ clearFirst: voiceChanged });

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

      // Auto-sync gateway to FreeSWITCH
      syncAndReload().catch((err) => console.error("[telephony] Auto-sync failed:", err));

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

    // Auto-sync after trunk removal
    syncAndReload().catch((err) => console.error("[telephony] Auto-sync failed:", err));

    return c.json({ success: true });
  });

  // ─── Contacts ──────────────────────────────────────────────────────

  /** List all contacts */
  api.get("/telephony/contacts", (c) => {
    return c.json({ contacts: store.getContacts() });
  });

  /** Add a contact */
  api.post("/telephony/contacts", async (c) => {
    try {
      const body = await c.req.json() as Omit<TelephonyContact, "id">;
      if (!body.name?.trim() || !body.phone?.trim()) {
        return c.json({ error: "name and phone are required" }, 400);
      }
      let phone = body.phone.replace(/\s/g, "");
      if (!phone.startsWith("+")) {
        if (phone.startsWith("0")) phone = "+43" + phone.slice(1);
        else phone = "+" + phone;
      }
      const contact: TelephonyContact = {
        id: randomUUID(),
        name: body.name.trim(),
        phone,
        notes: body.notes?.trim() || undefined,
      };
      store.addContact(contact);
      warmGreetingsAsync();
      return c.json(contact);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to add contact" }, 500);
    }
  });

  /** Update a contact */
  api.put("/telephony/contacts/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json() as Partial<Omit<TelephonyContact, "id">>;
      if (body.phone) {
        let phone = body.phone.replace(/\s/g, "");
        if (!phone.startsWith("+")) {
          if (phone.startsWith("0")) phone = "+43" + phone.slice(1);
          else phone = "+" + phone;
        }
        body.phone = phone;
      }
      const updated = store.updateContact(id, body);
      if (!updated) return c.json({ error: "Contact not found" }, 404);
      // Re-render greeting if name/phone changed
      if (body.name || body.phone) warmGreetingsAsync();
      return c.json(updated);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to update contact" }, 500);
    }
  });

  /** Delete a contact */
  api.delete("/telephony/contacts/:id", (c) => {
    const id = c.req.param("id");
    const deleted = store.deleteContact(id);
    if (!deleted) return c.json({ error: "Contact not found" }, 404);
    return c.json({ success: true });
  });

  /** Test FreeSWITCH ESL connection (TCP) */
  api.post("/telephony/test-connection", async (c) => {
    const settings = store.getSettings();

    try {
      const result = await eslStatus(settings.freeswitch);
      return c.json({ connected: result.connected, status: result.status });
    } catch (err) {
      return c.json({
        connected: false,
        error: err instanceof Error ? err.message : "Connection failed",
      });
    }
  });

  /** Sync gateway configs to FreeSWITCH and reload */
  api.post("/telephony/sync", async (c) => {
    try {
      await syncAndReload();
      return c.json({ success: true, message: "Gateway configs synced and reloaded." });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Sync failed" }, 500);
    }
  });

  /** Check gateway registration status */
  api.get("/telephony/trunks/:id/status", async (c) => {
    const id = c.req.param("id");
    try {
      const status = await checkGatewayStatus(id);
      return c.json(status);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Status check failed" }, 500);
    }
  });
}
