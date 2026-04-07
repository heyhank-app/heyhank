// ─── Assistant Routes ─────────────────────────────────────────────────────────
// REST API for todos, notes, and reminders.

import type { Hono } from "hono";
import * as store from "../assistant-store.js";

export function registerAssistantRoutes(api: Hono): void {
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
    const body = await c.req.json<{ text: string; priority?: string; category?: string }>();
    if (!body.text) return c.json({ error: "text is required" }, 400);
    const todo = store.addTodo(body.text, body.priority, body.category);
    return c.json(todo);
  });

  api.patch("/assistant/todos/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ text?: string; priority?: string; category?: string; done?: boolean }>();
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
    return c.json(reminder);
  });

  api.delete("/assistant/reminders/:id", (c) => {
    const ok = store.deleteReminder(c.req.param("id"));
    return c.json({ ok });
  });
}
