// ─── Email Routes ────────────────────────────────────────────────────────────
// REST API for multi-account email management (IMAP/SMTP).

import type { Hono } from "hono";
import * as email from "../email-service.js";
import type { EmailAccount } from "../email-service.js";

/** Strip auth.pass from an account object before returning it to the client. */
function sanitizeAccount(account: EmailAccount): Omit<EmailAccount, "auth"> & { auth: { user: string } } {
  const { auth, ...rest } = account;
  return { ...rest, auth: { user: auth.user } };
}

export function registerEmailRoutes(api: Hono): void {
  // ─── Account Management ─────────────────────────────────────────────

  api.get("/assistant/email/accounts", (c) => {
    const accounts = email.loadAccounts().map(sanitizeAccount);
    return c.json({ accounts });
  });

  api.post("/assistant/email/accounts", async (c) => {
    const body = await c.req.json<{
      name: string;
      email: string;
      imap: { host: string; port: number; secure: boolean };
      smtp: { host: string; port: number; secure: boolean };
      auth: { user: string; pass: string };
    }>();
    if (!body.name || !body.email || !body.imap || !body.smtp || !body.auth) {
      return c.json({ error: "name, email, imap, smtp, and auth are required" }, 400);
    }
    const account = email.addAccount(body);
    return c.json(sanitizeAccount(account));
  });

  api.delete("/assistant/email/accounts/:id", (c) => {
    const ok = email.removeAccount(c.req.param("id"));
    return c.json({ ok });
  });

  api.post("/assistant/email/accounts/:id/test", async (c) => {
    const account = email.getAccount(c.req.param("id"));
    if (!account) return c.json({ error: "account not found" }, 404);
    try {
      await email.listEmails(account, { limit: 1 });
      return c.json({ ok: true, message: "IMAP connection successful" });
    } catch (err: any) {
      return c.json({ ok: false, error: err?.message || "connection failed" }, 500);
    }
  });

  // ─── Unread Summary ─────────────────────────────────────────────────

  api.get("/assistant/email/unread", async (c) => {
    try {
      const summary = await email.getUnreadSummary();
      return c.json({ summary });
    } catch (err: any) {
      return c.json({ error: err?.message || "failed to get unread summary" }, 500);
    }
  });

  // ─── Per-Account Email Operations ───────────────────────────────────

  api.get("/assistant/email/:accountId/messages", async (c) => {
    const account = email.getAccount(c.req.param("accountId"));
    if (!account) return c.json({ error: "account not found" }, 404);

    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
    const unseen = c.req.query("unseen") === "true" ? true : undefined;
    const folder = c.req.query("folder") || undefined;

    try {
      const messages = await email.listEmails(account, { limit, unseen, folder });
      return c.json({ messages });
    } catch (err: any) {
      return c.json({ error: err?.message || "failed to list emails" }, 500);
    }
  });

  api.get("/assistant/email/:accountId/messages/:uid", async (c) => {
    const account = email.getAccount(c.req.param("accountId"));
    if (!account) return c.json({ error: "account not found" }, 404);

    const uid = Number(c.req.param("uid"));
    const folder = c.req.query("folder") || undefined;

    try {
      const message = await email.readEmail(account, uid, folder);
      if (!message) return c.json({ error: "message not found" }, 404);
      return c.json({ message });
    } catch (err: any) {
      return c.json({ error: err?.message || "failed to read email" }, 500);
    }
  });

  api.get("/assistant/email/:accountId/search", async (c) => {
    const account = email.getAccount(c.req.param("accountId"));
    if (!account) return c.json({ error: "account not found" }, 404);

    const q = c.req.query("q");
    if (!q) return c.json({ error: "q query parameter is required" }, 400);
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

    try {
      const messages = await email.searchEmails(account, q, limit);
      return c.json({ messages });
    } catch (err: any) {
      return c.json({ error: err?.message || "search failed" }, 500);
    }
  });

  api.post("/assistant/email/:accountId/send", async (c) => {
    const account = email.getAccount(c.req.param("accountId"));
    if (!account) return c.json({ error: "account not found" }, 404);

    const body = await c.req.json<{ to: string; subject: string; body: string }>();
    if (!body.to || !body.subject || !body.body) {
      return c.json({ error: "to, subject, and body are required" }, 400);
    }

    try {
      const result = await email.sendEmail(account, body.to, body.subject, body.body);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err?.message || "failed to send email" }, 500);
    }
  });

  api.post("/assistant/email/:accountId/reply", async (c) => {
    const account = email.getAccount(c.req.param("accountId"));
    if (!account) return c.json({ error: "account not found" }, 404);

    const body = await c.req.json<{ uid: number; body: string }>();
    if (!body.uid || !body.body) {
      return c.json({ error: "uid and body are required" }, 400);
    }

    try {
      const result = await email.replyToEmail(account, body.uid, body.body);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err?.message || "failed to reply" }, 500);
    }
  });
}
