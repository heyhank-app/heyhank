// ─── Assistant Routes ─────────────────────────────────────────────────────────
// REST API for todos, notes, and reminders.

import type { Hono } from "hono";
import * as store from "../assistant-store.js";
import * as calendarService from "../calendar-service.js";
import * as emailService from "../email-service.js";

export function registerAssistantRoutes(api: Hono): void {
  // ─── Daily Briefing ──────────────────────────────────────────────────

  api.get("/assistant/briefing", async (c) => {
    const dateStr = (c.req.query("date") as string) || new Date().toISOString().slice(0, 10);
    const today = dateStr;
    const tomorrowDate = new Date(dateStr);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toISOString().slice(0, 10);

    let emailSummary: Array<{ accountName: string; email: string; unread: number }> = [];
    let totalUnread = 0;
    try {
      emailSummary = await emailService.getUnreadSummary();
      totalUnread = emailSummary.reduce((s, a) => s + a.unread, 0);
    } catch {}

    let todayEvents: Array<Record<string, unknown>> = [];
    try {
      const calAccounts = calendarService.loadAccounts();
      for (const acc of calAccounts) {
        const events = await calendarService.listEvents(acc, { from: today, to: tomorrow });
        todayEvents.push(...events.map((e) => ({ ...e, account: acc.name })));
      }
    } catch {}

    const allTodos = store.listTodos({ done: false });
    const overdueTodos = allTodos.filter((t) => t.dueDate && t.dueDate < today);
    const dueTodayTodos = allTodos.filter((t) => t.dueDate === today);

    const delegations = store.listDelegations();

    const projectTodos = store.listTodos();
    const projects: Record<string, { total: number; done: number; open: number }> = {};
    for (const t of projectTodos) {
      if (!t.project) continue;
      if (!projects[t.project]) projects[t.project] = { total: 0, done: 0, open: 0 };
      projects[t.project].total++;
      if (t.done) projects[t.project].done++;
      else projects[t.project].open++;
    }

    return c.json({
      date: today,
      email: { accounts: emailSummary, totalUnread },
      calendar: { events: todayEvents, count: todayEvents.length },
      todos: { open: allTodos.length, overdue: overdueTodos.length, dueToday: dueTodayTodos.length },
      delegations: { count: delegations.length },
      projects: Object.entries(projects).map(([name, p]) => ({ name, ...p })),
    });
  });

  // ─── Todos ──────────────────────────────────────────────────────────

  api.get("/assistant/todos", (c) => {
    const done = c.req.query("done");
    const priority = c.req.query("priority");
    const category = c.req.query("category");
    const filter: { done?: boolean; priority?: string; category?: string } = {};
    if (done !== undefined) filter.done = done === "true";
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    return c.json({ todos: store.listTodos(filter) });
  });

  api.post("/assistant/todos", async (c) => {
    const body = await c.req.json<{ text: string; priority?: string; category?: string; delegatedTo?: string; dueDate?: string; followUpDate?: string; project?: string }>();
    if (!body.text) return c.json({ error: "text is required" }, 400);
    const extra = {
      delegatedTo: body.delegatedTo,
      dueDate: body.dueDate,
      followUpDate: body.followUpDate,
      project: body.project,
    };
    const todo = store.addTodo(body.text, body.priority, body.category, extra);
    return c.json(todo);
  });

  api.patch("/assistant/todos/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ text?: string; priority?: string; category?: string; done?: boolean; delegatedTo?: string; dueDate?: string; followUpDate?: string; project?: string }>();
    if (body.done === true) {
      const todo = store.completeTodo(id);
      if (!todo) return c.json({ error: "not found" }, 404);
      return c.json(todo);
    }
    const todo = store.updateTodo(id, body);
    if (!todo) return c.json({ error: "not found" }, 404);
    return c.json(todo);
  });

  api.delete("/assistant/todos/:id", (c) => {
    const ok = store.deleteTodo(c.req.param("id"));
    return c.json({ ok });
  });

  // ─── Delegations ──────────────────────────────────────────────────────

  api.get("/assistant/delegations", (c) => {
    const person = c.req.query("person");
    return c.json({ delegations: store.listDelegations(person) });
  });

  // ─── Notes ──────────────────────────────────────────────────────────

  api.get("/assistant/notes", (c) => {
    const search = c.req.query("search");
    return c.json({ notes: store.listNotes(search) });
  });

  api.post("/assistant/notes", async (c) => {
    const body = await c.req.json<{ title: string; content: string; tags?: string[] }>();
    if (!body.title) return c.json({ error: "title is required" }, 400);
    const note = store.addNote(body.title, body.content || "", body.tags);
    return c.json(note);
  });

  api.patch("/assistant/notes/:id", async (c) => {
    const body = await c.req.json<{ title?: string; content?: string; tags?: string[] }>();
    const note = store.updateNote(c.req.param("id"), body);
    if (!note) return c.json({ error: "not found" }, 404);
    return c.json(note);
  });

  api.delete("/assistant/notes/:id", (c) => {
    const ok = store.deleteNote(c.req.param("id"));
    return c.json({ ok });
  });

  // ─── Reminders ──────────────────────────────────────────────────────

  api.get("/assistant/reminders", (c) => {
    const all = c.req.query("all") === "true";
    return c.json({ reminders: store.listReminders(all) });
  });

  api.post("/assistant/reminders", async (c) => {
    const body = await c.req.json<{ text: string; triggerAt: string }>();
    if (!body.text || !body.triggerAt) return c.json({ error: "text and triggerAt required" }, 400);
    const reminder = store.addReminder(body.text, body.triggerAt);
    // Try to create a calendar event for the reminder
    try {
      const accounts = calendarService.loadAccounts();
      if (accounts.length > 0) {
        const account = accounts[0]; // Use first calendar account
        const triggerDate = new Date(body.triggerAt);
        const endDate = new Date(triggerDate.getTime() + 15 * 60 * 1000); // 15 min event
        const result = await calendarService.createEvent(account, {
          summary: `Reminder: ${body.text}`,
          description: body.text,
          start: triggerDate.toISOString(),
          end: endDate.toISOString(),
          alarm: 0, // alarm at event time
        });
        // Save calendar UID back to reminder
        store.updateReminder(reminder.id, { calendarEventUid: result.uid });
        reminder.calendarEventUid = result.uid;
      }
    } catch (err) {
      // Calendar integration is best-effort — don't fail the reminder creation
      console.warn("[assistant] Failed to create calendar event for reminder:", err instanceof Error ? err.message : err);
    }
    return c.json(reminder);
  });

  api.patch("/assistant/reminders/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ text?: string; triggerAt?: string }>();
    if (!body.text && !body.triggerAt) return c.json({ error: "Nothing to update" }, 400);
    const updated = store.updateReminder(id, body);
    if (!updated) return c.json({ error: "Not found" }, 404);

    // If the reminder has a calendar event, try to update it
    if (updated.calendarEventUid && body.triggerAt) {
      try {
        const accounts = calendarService.loadAccounts();
        if (accounts.length > 0) {
          // Delete old event and create new one (simpler than CalDAV update)
          await calendarService.deleteEvent(accounts[0], updated.calendarEventUid).catch(() => {});
          const triggerDate = new Date(body.triggerAt || updated.triggerAt);
          const endDate = new Date(triggerDate.getTime() + 15 * 60 * 1000);
          const result = await calendarService.createEvent(accounts[0], {
            summary: `Reminder: ${updated.text}`,
            description: updated.text,
            start: triggerDate.toISOString(),
            end: endDate.toISOString(),
            alarm: 0,
          });
          store.updateReminder(id, { calendarEventUid: result.uid });
          updated.calendarEventUid = result.uid;
        }
      } catch (err) {
        console.warn("[assistant] Failed to update calendar event:", err instanceof Error ? err.message : err);
      }
    }

    return c.json(updated);
  });

  api.delete("/assistant/reminders/:id", async (c) => {
    const id = c.req.param("id");
    // Try to remove associated calendar event
    const reminders = store.listReminders(true);
    const reminder = reminders.find(r => r.id === id);
    if (reminder?.calendarEventUid) {
      try {
        const accounts = calendarService.loadAccounts();
        if (accounts.length > 0) {
          await calendarService.deleteEvent(accounts[0], reminder.calendarEventUid);
        }
      } catch { /* best-effort */ }
    }
    const ok = store.deleteReminder(id);
    return c.json({ ok });
  });

  // ─── Contacts ──────────────────────────────────────────────────────────

  api.get("/assistant/contacts", (c) => {
    const search = c.req.query("search");
    return c.json({ contacts: store.listContacts(search) });
  });

  api.post("/assistant/contacts", async (c) => {
    const body = await c.req.json<{ name: string; company?: string; email?: string; phone?: string; notes?: string; tags?: string[] }>();
    if (!body.name) return c.json({ error: "name is required" }, 400);
    const contact = store.addContact(body.name, body.company, body.email, body.phone, body.notes, body.tags);
    return c.json(contact);
  });

  api.get("/assistant/contacts/:id", (c) => {
    const contact = store.getContact(c.req.param("id"));
    if (!contact) return c.json({ error: "not found" }, 404);
    return c.json(contact);
  });

  api.patch("/assistant/contacts/:id", async (c) => {
    const body = await c.req.json<{ name?: string; company?: string; email?: string; phone?: string; notes?: string; tags?: string[] }>();
    const contact = store.updateContact(c.req.param("id"), body);
    if (!contact) return c.json({ error: "not found" }, 404);
    return c.json(contact);
  });

  api.delete("/assistant/contacts/:id", (c) => {
    const ok = store.deleteContact(c.req.param("id"));
    return c.json({ ok });
  });

  api.post("/assistant/contacts/:id/interactions", async (c) => {
    const body = await c.req.json<{ type: "call" | "email" | "meeting" | "note"; summary: string }>();
    if (!body.type || !body.summary) return c.json({ error: "type and summary are required" }, 400);
    const contact = store.logInteraction(c.req.param("id"), { type: body.type, summary: body.summary });
    if (!contact) return c.json({ error: "not found" }, 404);
    return c.json(contact);
  });

  // ─── Decisions ─────────────────────────────────────────────────────────

  api.get("/assistant/decisions", (c) => {
    const search = c.req.query("search");
    return c.json({ decisions: store.listDecisions(search) });
  });

  api.post("/assistant/decisions", async (c) => {
    const body = await c.req.json<{ title: string; context: string; decision: string; alternatives?: string[]; reasoning?: string; tags?: string[] }>();
    if (!body.title || !body.context || !body.decision) return c.json({ error: "title, context and decision are required" }, 400);
    const decision = store.addDecision(body.title, body.context, body.decision, body.alternatives, body.reasoning, body.tags);
    return c.json(decision);
  });

  api.delete("/assistant/decisions/:id", (c) => {
    const ok = store.deleteDecision(c.req.param("id"));
    return c.json({ ok });
  });
}
