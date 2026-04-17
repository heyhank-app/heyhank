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
import { executeHankTool } from "../hank-tool-executor.js";
import { getAuthStatus, attemptRefresh } from "../claude-auth-monitor.js";

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

    // Load phone contacts for Gemini
    let contacts: { name: string; phone: string; notes?: string }[] = [];
    try {
      const telStore = await import("../telephony/telephony-store.js");
      contacts = telStore.getContacts().map((c) => ({ name: c.name, phone: c.phone, notes: c.notes }));
    } catch { /* ignore */ }

    return c.json({
      apiKey,
      voice: settings.geminiVoice || "Kore",
      assistantName: settings.assistantName || "",
      userName: settings.userName || "",
      agents: [...agents, ...remoteAgents],
      recentConversations: contextNotes.map((n) => ({ title: n.title, content: n.content })),
      activeSessions: [...activeSessions, ...remoteSessionsList],
      contacts,
    });
  });

  /** Execute a Gemini tool call by proxying to internal API endpoints */
  api.post("/gemini/tool-call", async (c) => {
    const body = await c.req.json().catch(() => ({} as { name?: string; args?: Record<string, unknown> }));
    const { name, args } = body;
    const authHeader = c.req.header("Authorization") || "";
    const result = await executeHankTool(name || "", args, authHeader);
    return c.json({ result });
  });

  // ─── Gemini Conversation History ──────────────────────────────────────────

  api.get("/gemini/conversations", (c) => {
    return c.json(assistantStore.listGeminiConversations());
  });

  api.get("/gemini/conversations/:id", (c) => {
    const convo = assistantStore.getGeminiConversation(c.req.param("id"));
    if (!convo) return c.json({ error: "Not found" }, 404);
    return c.json(convo);
  });

  api.post("/gemini/conversations", async (c) => {
    const body = await c.req.json<{
      messages: Array<{ role: "user" | "gemini" | "system"; text: string; ts: number }>;
      duration?: number;
    }>();
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: "messages required" }, 400);
    }
    const convo = assistantStore.saveGeminiConversation(body.messages, body.duration);
    return c.json(convo);
  });

  api.delete("/gemini/conversations/:id", (c) => {
    const ok = assistantStore.deleteGeminiConversation(c.req.param("id"));
    return c.json({ ok });
  });

  // ─── Claude Auth Status ───────────────────────────────────────────────
  api.get("/claude/auth-status", (c) => {
    return c.json(getAuthStatus());
  });

  api.post("/claude/auth-refresh", async (c) => {
    const success = await attemptRefresh();
    return c.json({ ...getAuthStatus(), refreshed: success });
  });

  // ─── Export / Import (Backup) ─────────────────────────────────────────────

  api.get("/export", (c) => {
    const agents = listAgents();
    const settings = getSettings();
    const notes = assistantStore.listNotes();
    const todos = assistantStore.listTodos();
    const reminders = assistantStore.listReminders(true);
    const conversations = assistantStore.listGeminiConversations();
    return c.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      agents,
      settings,
      notes,
      todos,
      reminders,
      geminiConversations: conversations,
    });
  });

  api.post("/import", async (c) => {
    const body = await c.req.json<{
      agents?: unknown[];
      notes?: unknown[];
      todos?: unknown[];
      reminders?: unknown[];
    }>();
    const imported: Record<string, number> = {};
    if (Array.isArray(body.agents)) {
      for (const a of body.agents) {
        try {
          createAgent(a as Parameters<typeof createAgent>[0]);
          imported.agents = (imported.agents || 0) + 1;
        } catch {}
      }
    }
    if (Array.isArray(body.notes)) {
      for (const n of body.notes as Array<{ title?: string; content?: string; tags?: string[] }>) {
        if (n.title && n.content) {
          assistantStore.addNote(n.title, n.content, n.tags || []);
          imported.notes = (imported.notes || 0) + 1;
        }
      }
    }
    if (Array.isArray(body.todos)) {
      for (const t of body.todos as Array<{ text?: string; priority?: string; category?: string }>) {
        if (t.text) {
          assistantStore.addTodo(t.text, t.priority || "medium", t.category);
          imported.todos = (imported.todos || 0) + 1;
        }
      }
    }
    return c.json({ imported });
  });
}
