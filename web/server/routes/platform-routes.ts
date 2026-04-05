// ─── Platform Routes ─────────────────────────────────────────────────────────
// Routes for MessageBus, CostTracker, KillSwitch, SharedContext

import type { Hono } from "hono";
import { messageBus, VALID_MESSAGE_TYPES } from "../message-bus.js";
import type { MessageType } from "../message-bus.js";
import { costTracker } from "../cost-tracker.js";
import * as killSwitch from "../kill-switch.js";
import * as sharedContext from "../shared-context.js";
import * as autoApprove from "../auto-approve.js";
import { getSettings } from "../settings-manager.js";
import * as pushNotifications from "../push-notifications.js";
import { getTimeoutConfig } from "../agent-timeout.js";
import * as assistantStore from "../assistant-store.js";
import * as emailService from "../email-service.js";
import * as calendarService from "../calendar-service.js";
import * as mcpRegistry from "../mcp-registry.js";
import type { McpServerEntry } from "../mcp-registry.js";
import type { CalendarAccount } from "../calendar-service.js";
import { listAgents, createAgent } from "../agent-store.js";
import { nodeManager } from "../federation/node-manager.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function registerPlatformRoutes(api: Hono): void {
  // ─── Message Bus ─────────────────────────────────────────────────────

  /** List messages with optional filters */
  api.get("/messages", (c) => {
    const query = {
      to: c.req.query("to"),
      from: c.req.query("from"),
      channel: c.req.query("channel"),
      type: c.req.query("type") as MessageType | undefined,
      unreadBy: c.req.query("unreadBy"),
      since: c.req.query("since"),
      limit: c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined,
    };
    // Remove undefined values
    const cleanQuery = Object.fromEntries(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null),
    );
    return c.json(messageBus.query(cleanQuery));
  });

  /** Post a new message */
  api.post("/messages", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.from || !body.content || !body.type) {
      return c.json({ error: "from, type, and content are required" }, 400);
    }
    if (!VALID_MESSAGE_TYPES.includes(body.type)) {
      return c.json({ error: `Invalid type. Valid: ${VALID_MESSAGE_TYPES.join(", ")}` }, 400);
    }
    const msg = messageBus.post({
      from: body.from,
      fromName: body.fromName,
      to: body.to,
      channel: body.channel,
      type: body.type,
      content: body.content,
      metadata: body.metadata,
    });
    return c.json(msg, 201);
  });

  /** Mark a message as read */
  api.post("/messages/:id/read", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.agentId) {
      return c.json({ error: "agentId is required" }, 400);
    }
    messageBus.markRead(c.req.param("id"), body.agentId);
    return c.json({ ok: true });
  });

  /** Mark all messages as read for an agent */
  api.post("/messages/read-all", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.agentId) {
      return c.json({ error: "agentId is required" }, 400);
    }
    messageBus.markAllRead(body.agentId);
    return c.json({ ok: true });
  });

  /** Get unread count for an agent */
  api.get("/messages/unread/:agentId", (c) => {
    const count = messageBus.unreadCount(c.req.param("agentId"));
    return c.json({ count });
  });

  /** Delete a message */
  api.delete("/messages/:id", (c) => {
    const deleted = messageBus.deleteMessage(c.req.param("id"));
    if (!deleted) return c.json({ error: "Message not found" }, 404);
    return c.json({ ok: true });
  });

  /** Clear all messages */
  api.delete("/messages", (c) => {
    messageBus.clearAll();
    return c.json({ ok: true });
  });

  // ─── Cost Tracker ────────────────────────────────────────────────────

  /** Get all cost records */
  api.get("/costs", (c) => {
    const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : 500;
    return c.json(costTracker.getAll(limit));
  });

  /** Get cost summary */
  api.get("/costs/summary", (c) => {
    return c.json(costTracker.getSummary());
  });

  /** Upsert a cost record */
  api.post("/costs", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.agentId || !body.agentName || !body.model) {
      return c.json({ error: "agentId, agentName, and model are required" }, 400);
    }
    costTracker.upsert({
      agentId: body.agentId,
      agentName: body.agentName,
      model: body.model,
      tokensIn: body.tokensIn ?? 0,
      tokensOut: body.tokensOut ?? 0,
      estimatedCost: body.estimatedCost ?? 0,
      createdAt: body.createdAt ?? new Date().toISOString(),
      closedAt: body.closedAt ?? null,
    });
    return c.json({ ok: true });
  });

  /** Finalize a cost record */
  api.post("/costs/:agentId/finalize", (c) => {
    costTracker.finalize(c.req.param("agentId"));
    return c.json({ ok: true });
  });

  /** Get/set spend limit */
  api.get("/costs/limit", (c) => {
    return c.json({ limit: costTracker.getSpendLimit() });
  });

  api.put("/costs/limit", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    costTracker.setSpendLimit(body.limit ?? null);
    return c.json({ ok: true });
  });

  /** Reset all cost records */
  api.delete("/costs", (c) => {
    const deleted = costTracker.reset();
    return c.json({ deleted });
  });

  // ─── Kill Switch ─────────────────────────────────────────────────────

  /** Get kill switch state */
  api.get("/kill-switch", (c) => {
    return c.json(killSwitch.getKillSwitchState());
  });

  /** Activate kill switch */
  api.post("/kill-switch/activate", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const state = killSwitch.activate(body.reason);
    return c.json(state);
  });

  /** Deactivate kill switch */
  api.post("/kill-switch/deactivate", (c) => {
    const state = killSwitch.deactivate();
    return c.json(state);
  });

  // ─── Shared Context ──────────────────────────────────────────────────

  /** List all context files */
  api.get("/shared-context", (c) => {
    return c.json(sharedContext.listContextFiles());
  });

  /** Get a specific context file */
  api.get("/shared-context/:filename", (c) => {
    const file = sharedContext.getContextFile(c.req.param("filename"));
    if (!file) return c.json({ error: "Not found" }, 404);
    return c.json(file);
  });

  /** Create or update a context file */
  api.put("/shared-context/:filename", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.content && body.content !== "") {
      return c.json({ error: "content is required" }, 400);
    }
    const file = sharedContext.writeContextFile(c.req.param("filename"), body.content);
    return c.json(file);
  });

  /** Delete a context file */
  api.delete("/shared-context/:filename", (c) => {
    const deleted = sharedContext.deleteContextFile(c.req.param("filename"));
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  // ─── Auto-Approve ────────────────────────────────────────────────────

  /** Get auto-approve rules */
  api.get("/auto-approve/rules", (c) => {
    return c.json({ rules: autoApprove.getRules() });
  });

  /** Evaluate a permission request */
  api.post("/auto-approve/evaluate", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.agentId || !body.toolName) {
      return c.json({ error: "agentId and toolName are required" }, 400);
    }
    const result = autoApprove.evaluate(
      body.agentId,
      body.toolName,
      body.toolInput || {},
      body.aiVerdict,
    );
    return c.json(result);
  });

  // ─── Push Notifications ──────────────────────────────────────────────

  /** Get VAPID public key */
  api.get("/push/vapid-key", (c) => {
    return c.json({ publicKey: pushNotifications.getPublicVapidKey() });
  });

  /** Subscribe to push notifications */
  api.post("/push/subscribe", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.subscription?.endpoint || !body.subscription?.keys) {
      return c.json({ error: "Valid subscription object required" }, 400);
    }
    pushNotifications.addSubscription(body.subscription);
    return c.json({ ok: true });
  });

  /** Unsubscribe from push notifications */
  api.post("/push/unsubscribe", (c) => {
    pushNotifications.clearSubscriptions();
    return c.json({ ok: true });
  });

  /** Send a test notification */
  api.post("/push/test", async (c) => {
    const result = await pushNotifications.sendNotification(
      "🧪 Test Notification",
      "Push notifications are working!",
      { tag: "test" },
    );
    return c.json({ ok: true, ...result });
  });

  /** Get push subscription count */
  api.get("/push/status", (c) => {
    return c.json({
      subscriptions: pushNotifications.getSubscriptionCount(),
      vapidConfigured: true,
    });
  });

  // ─── MCP Plugins ────────────────────────────────────────────────────

  /** List installed MCP plugins — now backed by mcp-registry */
  api.get("/mcp/plugins", (c) => {
    const servers = mcpRegistry.listServers();
    const plugins = servers.map((s) => ({
      name: s.name,
      type: s.type,
      configured: s.enabled && (!s.requiresAuth || s.requiresAuth.every(
        (a) => s.authValues?.[a.field],
      )),
    }));
    return c.json({ plugins, total: plugins.length });
  });

  // ─── MCP Server Registry ─────────────────────────────────────────────

  /** List all configured MCP servers */
  api.get("/mcp/servers", (c) => {
    const agentId = c.req.query("agentId");
    const servers = agentId
      ? mcpRegistry.getServersForAgent(agentId)
      : mcpRegistry.listServers();
    return c.json({ servers, total: servers.length });
  });

  /** List available MCP catalog templates */
  api.get("/mcp/catalog", (c) => {
    return c.json({ catalog: mcpRegistry.getCatalog() });
  });

  /** Add a new MCP server (or install from catalog via { catalogId }) */
  api.post("/mcp/servers", async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));

    try {
      // Install from catalog
      if (body.catalogId) {
        const server = mcpRegistry.addFromCatalog(body.catalogId as string);
        return c.json(server, 201);
      }

      // Custom server
      if (!body.name || !body.type) {
        return c.json({ error: "name and type are required" }, 400);
      }
      if (body.type === "stdio" && !body.command) {
        return c.json({ error: "command is required for stdio servers" }, 400);
      }
      if ((body.type === "http" || body.type === "sse") && !body.url) {
        return c.json({ error: "url is required for http/sse servers" }, 400);
      }

      const server = mcpRegistry.addServer({
        name: body.name as string,
        description: (body.description as string) || "",
        type: body.type as "stdio" | "http" | "sse",
        command: body.command as string | undefined,
        args: body.args as string[] | undefined,
        url: body.url as string | undefined,
        headers: body.headers as Record<string, string> | undefined,
        env: body.env as Record<string, string> | undefined,
        enabled: body.enabled !== false,
        assignedAgents: (body.assignedAgents as string[]) || ["*"],
        requiresAuth: body.requiresAuth as McpServerEntry["requiresAuth"],
        authValues: body.authValues as Record<string, string> | undefined,
      });
      return c.json(server, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  /** Update an MCP server config */
  api.put("/mcp/servers/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));

    const updated = mcpRegistry.updateServer(id, body as Partial<McpServerEntry>);
    if (!updated) return c.json({ error: "Server not found" }, 404);
    return c.json(updated);
  });

  /** Remove an MCP server */
  api.delete("/mcp/servers/:id", (c) => {
    const removed = mcpRegistry.removeServer(c.req.param("id"));
    if (!removed) return c.json({ error: "Server not found" }, 404);
    return c.json({ ok: true });
  });

  /** Toggle enable/disable for an MCP server */
  api.post("/mcp/servers/:id/toggle", (c) => {
    const id = c.req.param("id");
    const server = mcpRegistry.getServer(id);
    if (!server) return c.json({ error: "Server not found" }, 404);

    const updated = mcpRegistry.updateServer(id, { enabled: !server.enabled });
    return c.json(updated);
  });

  // ─── Agent Timeouts ──────────────────────────────────────────────────

  /** Get timeout configuration */
  api.get("/agent-timeouts", (c) => {
    return c.json(getTimeoutConfig());
  });

  // ─── Email Accounts ─────────────────────────────────────────────────

  /** List all email accounts (without passwords) */
  api.get("/email-accounts", (c) => {
    const accounts = emailService.loadAccounts();
    return c.json(accounts.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      imap: a.imap,
      smtp: a.smtp,
      auth: { user: a.auth.user, pass: "" }, // never send password
    })));
  });

  /** Add a new email account */
  api.post("/email-accounts", async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    if (!body.name || !body.email || !body.imap || !body.smtp || !body.auth) {
      return c.json({ error: "name, email, imap, smtp, and auth are required" }, 400);
    }
    const account = emailService.addAccount(body as Omit<emailService.EmailAccount, "id">);
    return c.json({ id: account.id, name: account.name, email: account.email });
  });

  /** Update an email account */
  api.put("/email-accounts/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const accounts = emailService.loadAccounts();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx === -1) return c.json({ error: "Account not found" }, 404);

    // Merge fields
    if (body.name) accounts[idx].name = body.name as string;
    if (body.email) accounts[idx].email = body.email as string;
    if (body.imap) accounts[idx].imap = body.imap as typeof accounts[0]["imap"];
    if (body.smtp) accounts[idx].smtp = body.smtp as typeof accounts[0]["smtp"];
    if (body.auth) {
      const auth = body.auth as { user?: string; pass?: string };
      if (auth.user) accounts[idx].auth.user = auth.user;
      if (auth.pass) accounts[idx].auth.pass = auth.pass; // only update if provided
    }

    emailService.saveAccounts(accounts);
    return c.json({ ok: true });
  });

  /** Delete an email account */
  api.delete("/email-accounts/:id", (c) => {
    const removed = emailService.removeAccount(c.req.param("id"));
    if (!removed) return c.json({ error: "Account not found" }, 404);
    return c.json({ ok: true });
  });

  /** Test email account connection */
  api.post("/email-accounts/:id/test", async (c) => {
    const account = emailService.loadAccounts().find((a) => a.id === c.req.param("id"));
    if (!account) return c.json({ error: "Account not found" }, 404);
    try {
      const emails = await emailService.listEmails(account, { limit: 1 });
      return c.json({ ok: true, message: `Connected successfully. ${emails.length} email(s) found.` });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── Calendar Accounts ──────────────────────────────────────────────

  /** List all calendar accounts (without passwords) */
  api.get("/calendar-accounts", (c) => {
    const accounts = calendarService.loadAccounts();
    return c.json(accounts.map((a) => ({
      id: a.id,
      name: a.name,
      provider: a.provider,
      serverUrl: a.serverUrl,
      auth: { user: a.auth.user, pass: "" },
      defaultCalendarId: a.defaultCalendarId,
    })));
  });

  /** Add a new calendar account */
  api.post("/calendar-accounts", async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    if (!body.name || !body.provider || !body.auth) {
      return c.json({ error: "name, provider, and auth are required" }, 400);
    }
    const preset = calendarService.PROVIDER_PRESETS[body.provider as string];
    const serverUrl = (body.serverUrl as string) || preset?.serverUrl || "";
    if (!serverUrl) {
      return c.json({ error: "serverUrl is required for custom CalDAV providers" }, 400);
    }
    const account = calendarService.addAccount({
      name: body.name as string,
      provider: body.provider as CalendarAccount["provider"],
      serverUrl,
      auth: body.auth as { user: string; pass: string },
      defaultCalendarId: body.defaultCalendarId as string | undefined,
    });
    return c.json({ id: account.id, name: account.name });
  });

  /** Update a calendar account */
  api.put("/calendar-accounts/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const accounts = calendarService.loadAccounts();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx === -1) return c.json({ error: "Account not found" }, 404);

    if (body.name) accounts[idx].name = body.name as string;
    if (body.provider) accounts[idx].provider = body.provider as CalendarAccount["provider"];
    if (body.serverUrl) accounts[idx].serverUrl = body.serverUrl as string;
    if (body.defaultCalendarId !== undefined) accounts[idx].defaultCalendarId = body.defaultCalendarId as string;
    if (body.auth) {
      const auth = body.auth as { user?: string; pass?: string };
      if (auth.user) accounts[idx].auth.user = auth.user;
      if (auth.pass) accounts[idx].auth.pass = auth.pass;
    }

    calendarService.saveAccounts(accounts);
    return c.json({ ok: true });
  });

  /** Delete a calendar account */
  api.delete("/calendar-accounts/:id", (c) => {
    const removed = calendarService.removeAccount(c.req.param("id"));
    if (!removed) return c.json({ error: "Account not found" }, 404);
    return c.json({ ok: true });
  });

  /** Test calendar account connection */
  api.post("/calendar-accounts/:id/test", async (c) => {
    const account = calendarService.loadAccounts().find((a) => a.id === c.req.param("id"));
    if (!account) return c.json({ error: "Account not found" }, 404);
    try {
      const calendars = await calendarService.listCalendars(account);
      return c.json({ ok: true, message: `Connected successfully. ${calendars.length} calendar(s) found.`, calendars: calendars.map((c) => c.displayName) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** List calendars for an account */
  api.get("/calendar-accounts/:id/calendars", async (c) => {
    const account = calendarService.loadAccounts().find((a) => a.id === c.req.param("id"));
    if (!account) return c.json({ error: "Account not found" }, 404);
    try {
      const calendars = await calendarService.listCalendars(account);
      return c.json(calendars);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  /** Get calendar provider presets */
  api.get("/calendar-presets", (c) => {
    return c.json(calendarService.PROVIDER_PRESETS);
  });

  // ─── Gemini Live ───────────────────────────────────────────────────

  /** Get Gemini API config for voice chat (settings first, env fallback) */
  api.get("/gemini/config", async (c) => {
    const settings = getSettings();
    const apiKey = settings.geminiApiKey.trim() || process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
      return c.json({ error: "Gemini API key not configured. Add it in Settings → Gemini." }, 500);
    }
    // Include agent list for system prompt enrichment
    const agents = listAgents().map((a) => ({ id: a.id, name: a.name, description: a.description, backend: a.backendType }));

    // Load recent Gemini conversation context for persistence
    const recentNotes = assistantStore.listNotes("gemini-live");
    const contextNotes = recentNotes.slice(-3); // last 3 conversations

    // Fetch active session status so Gemini knows what's running
    let activeSessions: { sessionId: string; state: string; model?: string; agentName?: string; cwd?: string }[] = [];
    try {
      const port = process.env.PORT || 3100;
      const authHeader = c.req.header("Authorization") || "";
      const sessResp = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        headers: authHeader ? { Authorization: authHeader } : {},
      });
      if (sessResp.ok) {
        const all = (await sessResp.json()) as { sessionId: string; state: string; model?: string; agentName?: string; cwd?: string }[];
        activeSessions = all
          .filter((s) => s.state !== "exited")
          .map((s) => ({ sessionId: s.sessionId, state: s.state, model: s.model, agentName: s.agentName, cwd: s.cwd }));
      }
    } catch { /* ignore */ }

    // Merge remote federation sessions
    const remoteSessionsList = nodeManager.getRemoteSessions().map((rs) => ({
      sessionId: rs.sessionId,
      state: rs.status === "running" ? "running" : "connected",
      model: rs.model,
      cwd: rs.cwd,
      nodeName: rs.nodeName,
    }));

    // Merge remote federation agents
    const remoteAgents = nodeManager.getRemoteAgents().map((ra) => ({
      id: ra.id,
      name: ra.name,
      description: ra.description || "",
      backend: ra.backendType || "claude",
      nodeName: ra.nodeName,
    }));

    return c.json({
      apiKey,
      voice: settings.geminiVoice || "Kore",
      assistantName: settings.assistantName || "",
      agents: [...agents, ...remoteAgents],
      recentConversations: contextNotes.map((n) => ({ title: n.title, content: n.content })),
      activeSessions: [...activeSessions, ...remoteSessionsList],
    });
  });

  /** Execute a Gemini tool call by proxying to internal API endpoints */
  api.post("/gemini/tool-call", async (c) => {
    const body = await c.req.json().catch(() => ({} as { name?: string; args?: Record<string, unknown> }));
    const { name, args } = body;

    // Forward auth header from the original request
    const authHeader = c.req.header("Authorization") || "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
    const base = `http://127.0.0.1:${process.env.PORT || 3100}/api`;

    console.log(`[gemini-tool] ${name}`, JSON.stringify(args || {}).slice(0, 200));

    try {
      switch (name) {
        // ─── Agent Orchestration ──────────────────────────────────────
        case "run_agent": {
          const agentQuery = (args?.agent as string) || "";
          const task = (args?.task as string) || "";
          if (!agentQuery || !task) {
            return c.json({ result: { error: "agent and task are required" } });
          }

          // Fuzzy match agent by name or ID
          const agents = listAgents();
          let matched = agents.find((a) => a.id === agentQuery || a.name.toLowerCase() === agentQuery.toLowerCase());
          if (!matched) {
            // Fuzzy: find best match by name similarity
            const q = agentQuery.toLowerCase();
            let bestScore = 0;
            for (const a of agents) {
              const name = a.name.toLowerCase();
              let score = 0;
              if (name.includes(q) || q.includes(name)) score = 0.8;
              else {
                // Word overlap
                const qWords = q.split(/\s+/);
                const nWords = name.split(/\s+/);
                const overlap = qWords.filter((w) => nWords.some((n) => n.includes(w) || w.includes(n))).length;
                score = overlap / Math.max(qWords.length, nWords.length);
              }
              if (score > bestScore) { bestScore = score; matched = a; }
            }
            if (bestScore < 0.3) matched = undefined;
          }

          if (!matched) {
            const available = agents.map((a) => `"${a.name}" (${a.id})`).join(", ");
            return c.json({ result: { error: `Agent "${agentQuery}" not found. Available: ${available}` } });
          }

          // Run the agent via /api/agents/:id/run
          const runRes = await fetch(`${base}/agents/${matched.id}/run`, {
            method: "POST",
            headers,
            body: JSON.stringify({ input: task }),
          });
          const runData = await runRes.json() as Record<string, unknown>;

          if (!runRes.ok) {
            return c.json({ result: { error: `Failed to run agent: ${(runData as { error?: string }).error || "Unknown error"}` } });
          }

          const sessionId = (runData as { sessionId?: string }).sessionId || null;
          return c.json({
            result: {
              success: true,
              agentName: matched.name,
              agentId: matched.id,
              sessionId,
              model: matched.model,
              message: `Agent "${matched.name}" started with task.${sessionId ? ` Session ID: ${sessionId}. Use monitor_agent_session to check progress.` : ""}`,
            },
          });
        }

        case "create_agent": {
          const agentName = (args?.name as string) || "";
          const agentPrompt = (args?.prompt as string) || "";
          const agentDesc = (args?.description as string) || "";
          const agentModel = (args?.model as string) || "claude-sonnet-4-20250514";
          const agentCwd = (args?.cwd as string) || "";
          const autoStart = args?.autoStart as boolean;
          const autoTask = (args?.task as string) || "";

          if (!agentName || !agentPrompt) {
            return c.json({ result: { error: "name and prompt are required" } });
          }

          try {
            const newAgent = createAgent({
              name: agentName,
              description: agentDesc,
              prompt: agentPrompt,
              backendType: "claude",
              model: agentModel,
              permissionMode: "auto-accept",
              cwd: agentCwd,
            });

            let sessionId: string | null = null;
            if (autoStart && autoTask) {
              const runRes = await fetch(`${base}/agents/${newAgent.id}/run`, {
                method: "POST",
                headers,
                body: JSON.stringify({ input: autoTask }),
              });
              if (runRes.ok) {
                const runData = await runRes.json() as { sessionId?: string };
                sessionId = runData.sessionId || null;
              }
            }

            return c.json({
              result: {
                success: true,
                agentName: newAgent.name,
                agentId: newAgent.id,
                ...(sessionId ? { sessionId, message: `Agent "${newAgent.name}" created and started. Session ID: ${sessionId}. Use monitor_agent_session to check progress.` } : { message: `Agent "${newAgent.name}" created successfully. Use run_agent to start it.` }),
              },
            });
          } catch (err) {
            return c.json({ result: { error: `Failed to create agent: ${err instanceof Error ? err.message : "Unknown error"}` } });
          }
        }

        case "list_sessions": {
          const res = await fetch(`${base}/sessions`, { headers });
          const sessions = await res.json() as Array<Record<string, unknown>>;
          // Return a compact summary
          const summary = sessions
            .filter((s) => s.state !== "exited" && !s.archived)
            .map((s) => ({
              id: s.sessionId,
              state: s.state,
              model: s.model || "unknown",
              backend: s.backendType || "claude",
              cwd: s.cwd,
              name: s.name || null,
            }));
          return c.json({ result: { sessions: summary, count: summary.length } });
        }

        case "create_session": {
          const backend = (args?.backend as string) || "claude";
          const cwd = (args?.cwd as string) || "/opt/agentplatform/web";
          const message = args?.message as string | undefined;

          const res = await fetch(`${base}/sessions/create`, {
            method: "POST",
            headers,
            body: JSON.stringify({ backend, cwd }),
          });
          const session = await res.json() as Record<string, unknown>;

          if (!res.ok) {
            const errMsg = typeof (session as { error?: string }).error === "string" ? (session as { error?: string }).error : "Unknown error";
            return c.json({ result: { error: `Failed to create session: ${errMsg}` } });
          }

          const result: Record<string, unknown> = {
            sessionId: session.sessionId,
            state: session.state,
            cwd: session.cwd,
            message: `Session created successfully with ${backend}.`,
          };

          // If there's an initial message, send it via WebSocket bridge endpoint
          if (message && session.sessionId) {
            result.initialMessage = message;
            result.note = "Initial message will be sent once the session is connected. The user should see it in the chat.";
            // Fire and forget — don't block the tool response to Gemini
            fetch(`${base}/gemini/send-to-session`, {
              method: "POST",
              headers,
              body: JSON.stringify({ sessionId: session.sessionId, message }),
            }).catch(() => {});
          }

          return c.json({ result });
        }

        case "send_message": {
          const sessionId = args?.session_id as string;
          const message = args?.message as string;

          if (!sessionId || !message) {
            return c.json({ result: { error: "session_id and message are required" } });
          }

          // Use the internal send endpoint
          const res = await fetch(`${base}/gemini/send-to-session`, {
            method: "POST",
            headers,
            body: JSON.stringify({ sessionId, message }),
          });
          const data = await res.json() as Record<string, unknown>;

          if (!res.ok) {
            const errMsg = typeof (data as { error?: string }).error === "string" ? (data as { error?: string }).error : "Unknown error";
            return c.json({ result: { error: `Failed to send message: ${errMsg}` } });
          }

          return c.json({ result: { success: true, sessionId, message: "Message sent to session." } });
        }

        case "get_session_status":
        case "monitor_agent_session": {
          const sessionId = args?.session_id as string;
          if (!sessionId) {
            return c.json({ result: { error: "session_id is required" } });
          }

          const res = await fetch(`${base}/sessions/${sessionId}/agent-status`, { headers });
          if (!res.ok) {
            return c.json({ result: { error: "Session not found" } });
          }
          const status = await res.json() as Record<string, unknown>;

          // Build a human-readable summary for Gemini
          let summary = "";
          if (status.needsInput) {
            const perms = status.pendingPermissions as Array<{ toolName: string; description: string }>;
            summary = `ATTENTION: Agent needs permission! Pending: ${perms.map((p) => `${p.toolName}${p.description ? ` (${p.description})` : ""}`).join(", ")}. Tell the user immediately!`;
          } else if (status.isCompleted) {
            summary = "Agent has finished. Task is complete.";
          } else if (status.isWorking) {
            summary = "Agent is still working...";
          } else {
            summary = `Agent phase: ${status.phase}`;
          }

          return c.json({
            result: {
              ...status,
              summary,
            },
          });
        }

        // ─── Todo Tools ───────────────────────────────────────────────
        case "list_todos": {
          const todos = assistantStore.listTodos({
            done: args?.show_completed ? undefined : false,
            priority: args?.priority as string | undefined,
            category: args?.category as string | undefined,
          });
          return c.json({ result: { todos, count: todos.length } });
        }

        case "add_todo": {
          const text = args?.text as string;
          if (!text) return c.json({ result: { error: "text is required" } });
          const todo = assistantStore.addTodo(text, args?.priority as string, args?.category as string | undefined);
          return c.json({ result: { todo, message: "Todo added." } });
        }

        case "complete_todo": {
          const id = args?.id as string;
          if (!id) return c.json({ result: { error: "id is required" } });
          const todo = assistantStore.completeTodo(id);
          return c.json({ result: todo ? { todo, message: "Todo completed." } : { error: "Todo not found" } });
        }

        case "delete_todo": {
          const id = args?.id as string;
          if (!id) return c.json({ result: { error: "id is required" } });
          const ok = assistantStore.deleteTodo(id);
          return c.json({ result: ok ? { message: "Todo deleted." } : { error: "Todo not found" } });
        }

        case "update_todo": {
          const id = args?.id as string;
          if (!id) return c.json({ result: { error: "id is required" } });
          const todo = assistantStore.updateTodo(id, {
            text: args?.text as string | undefined,
            priority: args?.priority as string | undefined,
            category: args?.category as string | undefined,
          });
          return c.json({ result: todo ? { todo, message: "Todo updated." } : { error: "Todo not found" } });
        }

        // ─── Note Tools ──────────────────────────────────────────────
        case "search_notes": {
          const notes = assistantStore.listNotes(args?.query as string | undefined);
          return c.json({ result: { notes, count: notes.length } });
        }

        case "add_note": {
          const title = args?.title as string;
          const content = args?.content as string || "";
          if (!title) return c.json({ result: { error: "title is required" } });
          const tags = args?.tags ? (args.tags as string).split(",").map((t: string) => t.trim()) : [];
          const note = assistantStore.addNote(title, content, tags);
          return c.json({ result: { note, message: "Note saved." } });
        }

        case "update_note": {
          const id = args?.id as string;
          if (!id) return c.json({ result: { error: "id is required" } });
          const tags = args?.tags ? (args.tags as string).split(",").map((t: string) => t.trim()) : undefined;
          const note = assistantStore.updateNote(id, {
            title: args?.title as string | undefined,
            content: args?.content as string | undefined,
            tags,
          });
          return c.json({ result: note ? { note, message: "Note updated." } : { error: "Note not found" } });
        }

        case "delete_note": {
          const id = args?.id as string;
          if (!id) return c.json({ result: { error: "id is required" } });
          const ok = assistantStore.deleteNote(id);
          return c.json({ result: ok ? { message: "Note deleted." } : { error: "Note not found" } });
        }

        // ─── Reminder Tools ──────────────────────────────────────────
        case "list_reminders": {
          const reminders = assistantStore.listReminders(!!args?.include_fired);
          return c.json({ result: { reminders, count: reminders.length } });
        }

        case "add_reminder": {
          const text = args?.text as string;
          const triggerAt = args?.trigger_at as string;
          if (!text || !triggerAt) return c.json({ result: { error: "text and trigger_at are required" } });
          const reminder = assistantStore.addReminder(text, triggerAt);
          return c.json({ result: { reminder, message: "Reminder set." } });
        }

        case "delete_reminder": {
          const id = args?.id as string;
          if (!id) return c.json({ result: { error: "id is required" } });
          const ok = assistantStore.deleteReminder(id);
          return c.json({ result: ok ? { message: "Reminder deleted." } : { error: "Reminder not found" } });
        }

        // ─── Email Tools ─────────────────────────────────────────────
        case "list_email_accounts": {
          const accounts = emailService.loadAccounts();
          return c.json({ result: { accounts: accounts.map((a) => ({ id: a.id, name: a.name, email: a.email })), count: accounts.length } });
        }

        case "list_emails": {
          const accountId = args?.account as string;
          if (!accountId) return c.json({ result: { error: "account (name, email or id) is required" } });
          const account = emailService.getAccount(accountId);
          if (!account) return c.json({ result: { error: `Account "${accountId}" not found. Use list_email_accounts to see available accounts.` } });
          const emails = await emailService.listEmails(account, {
            limit: (args?.limit as number) || 10,
            unseen: !!args?.unseen_only,
          });
          return c.json({ result: { emails, count: emails.length, account: account.name } });
        }

        case "read_email": {
          const accountId = args?.account as string;
          const uid = args?.uid as number;
          if (!accountId || !uid) return c.json({ result: { error: "account and uid are required" } });
          const account = emailService.getAccount(accountId);
          if (!account) return c.json({ result: { error: `Account "${accountId}" not found` } });
          const email = await emailService.readEmail(account, uid);
          return c.json({ result: email ? { email } : { error: "Email not found" } });
        }

        case "search_emails": {
          const accountId = args?.account as string;
          const query = args?.query as string;
          if (!accountId || !query) return c.json({ result: { error: "account and query are required" } });
          const account = emailService.getAccount(accountId);
          if (!account) return c.json({ result: { error: `Account "${accountId}" not found` } });
          const emails = await emailService.searchEmails(account, query, (args?.limit as number) || 10);
          return c.json({ result: { emails, count: emails.length } });
        }

        case "send_email": {
          const accountId = args?.account as string;
          const to = args?.to as string;
          const subject = args?.subject as string;
          const body = args?.body as string;
          if (!accountId || !to || !subject || !body) return c.json({ result: { error: "account, to, subject, and body are required" } });
          const account = emailService.getAccount(accountId);
          if (!account) return c.json({ result: { error: `Account "${accountId}" not found` } });
          const result = await emailService.sendEmail(account, to, subject, body);
          return c.json({ result: { ...result, message: `Email sent from ${account.email} to ${to}` } });
        }

        case "reply_email": {
          const accountId = args?.account as string;
          const uid = args?.uid as number;
          const body = args?.body as string;
          if (!accountId || !uid || !body) return c.json({ result: { error: "account, uid, and body are required" } });
          const account = emailService.getAccount(accountId);
          if (!account) return c.json({ result: { error: `Account "${accountId}" not found` } });
          const result = await emailService.replyToEmail(account, uid, body);
          return c.json({ result: { ...result, message: "Reply sent." } });
        }

        case "email_summary": {
          const summary = await emailService.getUnreadSummary();
          return c.json({ result: { accounts: summary, totalUnread: summary.reduce((s, a) => s + a.unread, 0) } });
        }

        // ─── Calendar Tools ────────────────────────────────────────────
        case "list_calendar_accounts": {
          const accounts = calendarService.loadAccounts();
          return c.json({ result: { accounts: accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider })), count: accounts.length } });
        }

        case "list_events": {
          const accountId = args?.account as string;
          if (!accountId) return c.json({ result: { error: "account (name or id) is required" } });
          const calAccount = calendarService.getAccount(accountId);
          if (!calAccount) return c.json({ result: { error: `Calendar account "${accountId}" not found. Use list_calendar_accounts to see available accounts.` } });
          const events = await calendarService.listEvents(calAccount, {
            from: args?.from as string | undefined,
            to: args?.to as string | undefined,
          });
          return c.json({ result: { events, count: events.length, account: calAccount.name } });
        }

        case "create_event": {
          const accountId = args?.account as string;
          const summary = args?.summary as string;
          const start = args?.start as string;
          const end = args?.end as string;
          if (!accountId || !summary || !start || !end) {
            return c.json({ result: { error: "account, summary, start, and end are required" } });
          }
          const calAccount = calendarService.getAccount(accountId);
          if (!calAccount) return c.json({ result: { error: `Calendar account "${accountId}" not found` } });
          const created = await calendarService.createEvent(calAccount, {
            summary,
            description: args?.description as string | undefined,
            location: args?.location as string | undefined,
            start,
            end,
            allDay: !!args?.all_day,
          });
          return c.json({ result: { ...created, message: `Event "${summary}" created.` } });
        }

        case "search_events": {
          const accountId = args?.account as string;
          const query = args?.query as string;
          if (!accountId || !query) return c.json({ result: { error: "account and query are required" } });
          const calAccount = calendarService.getAccount(accountId);
          if (!calAccount) return c.json({ result: { error: `Calendar account "${accountId}" not found` } });
          const events = await calendarService.searchEvents(calAccount, query, {
            from: args?.from as string | undefined,
            to: args?.to as string | undefined,
          });
          return c.json({ result: { events, count: events.length } });
        }

        case "delete_event": {
          const accountId = args?.account as string;
          const uid = args?.uid as string;
          if (!accountId || !uid) return c.json({ result: { error: "account and uid are required" } });
          const calAccount = calendarService.getAccount(accountId);
          if (!calAccount) return c.json({ result: { error: `Calendar account "${accountId}" not found` } });
          const deleted = await calendarService.deleteEvent(calAccount, uid);
          return c.json({ result: deleted ? { message: "Event deleted." } : { error: "Event not found" } });
        }

        case "calendar_summary": {
          const summary = await calendarService.getUpcomingSummary();
          return c.json({ result: { accounts: summary } });
        }

        // ─── Telephony ──────────────────────────────────────────────────
        case "make_call": {
          const phone = (args?.phone as string) || "";
          const task = (args?.task as string) || "";
          if (!phone || !task) {
            return c.json({ result: { error: "phone and task are required" } });
          }
          try {
            const { callManager } = await import("../telephony/call-manager.js");
            const call = await callManager.startCall({ phone, prompt: task, voice: args?.voice as string });
            return c.json({
              result: {
                success: true,
                callId: call.id,
                phone: call.phone,
                status: call.status,
                message: `Call to ${call.phone} initiated. Status: ${call.status}. Call ID: ${call.id}`,
              },
            });
          } catch (err) {
            return c.json({ result: { error: `Failed to start call: ${err instanceof Error ? err.message : "Unknown error"}` } });
          }
        }

        case "list_active_calls": {
          try {
            const { callManager } = await import("../telephony/call-manager.js");
            const calls = callManager.getActiveCalls();
            return c.json({
              result: {
                calls: calls.map((c) => ({
                  callId: c.id,
                  phone: c.phone,
                  status: c.status,
                  durationSeconds: c.connectedAt ? Math.round((Date.now() - c.connectedAt) / 1000) : 0,
                  prompt: c.prompt,
                })),
                message: calls.length > 0
                  ? `${calls.length} active call(s): ${calls.map((c) => `${c.phone} (${c.status})`).join(", ")}`
                  : "No active calls.",
              },
            });
          } catch {
            return c.json({ result: { calls: [], message: "No active calls." } });
          }
        }

        case "end_active_call": {
          const callId = (args?.call_id as string) || "";
          if (!callId) return c.json({ result: { error: "call_id is required" } });
          try {
            const { callManager } = await import("../telephony/call-manager.js");
            const result = await callManager.endCall(callId);
            if (!result) return c.json({ result: { error: "Call not found or already ended" } });
            return c.json({
              result: {
                success: true,
                summary: result.summary,
                durationSeconds: result.durationSeconds,
                message: `Call ended. Duration: ${result.durationSeconds}s. ${result.summary || ""}`,
              },
            });
          } catch (err) {
            return c.json({ result: { error: err instanceof Error ? err.message : "Failed to end call" } });
          }
        }

        default:
          return c.json({ result: { error: `Unknown tool: ${name}` } });
      }
    } catch (err) {
      return c.json({ result: { error: err instanceof Error ? err.message : String(err) } });
    }
  });
}
