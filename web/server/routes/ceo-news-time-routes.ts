import { Hono } from "hono";
import * as newsStore from "../ceo/news-store.js";
import * as timeStore from "../ceo/time-tracking-store.js";

export function registerCeoNewsTimeRoutes(api: Hono) {
  // === NEWS SOURCES ===
  api.get("/assistant/news/sources", (c) => {
    return c.json({ sources: newsStore.listSources() });
  });

  api.post("/assistant/news/sources", async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.type || !body.category) {
      return c.json({ error: "name, type, and category are required" }, 400);
    }
    const source = newsStore.addSource(body.name, body.type, body.category, body.url, body.keywords, body.checkInterval);
    return c.json(source, 201);
  });

  api.patch("/assistant/news/sources/:id", async (c) => {
    const body = await c.req.json();
    const source = newsStore.updateSource(c.req.param("id"), body);
    if (!source) return c.json({ error: "not found" }, 404);
    return c.json(source);
  });

  api.delete("/assistant/news/sources/:id", (c) => {
    const ok = newsStore.deleteSource(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ success: true });
  });

  // === NEWS ITEMS ===
  api.get("/assistant/news", (c) => {
    const category = c.req.query("category") || undefined;
    const unreadOnly = c.req.query("unread") === "true";
    const savedOnly = c.req.query("saved") === "true";
    const limit = parseInt(c.req.query("limit") || "50");
    return c.json({ items: newsStore.listNews(category, unreadOnly, savedOnly, limit) });
  });

  api.get("/assistant/news/stats", (c) => {
    return c.json(newsStore.getNewsStats());
  });

  api.get("/assistant/news/search", (c) => {
    const query = c.req.query("q") || "";
    return c.json({ items: newsStore.searchNews(query) });
  });

  api.post("/assistant/news/items", async (c) => {
    const body = await c.req.json();
    if (!body.sourceId || !body.title || !body.summary || !body.category) {
      return c.json({ error: "sourceId, title, summary, and category are required" }, 400);
    }
    const item = newsStore.addNewsItem(body.sourceId, body.sourceName || "", body.title, body.summary, body.category, body.url, body.relevance);
    return c.json(item, 201);
  });

  api.patch("/assistant/news/:id/read", (c) => {
    const ok = newsStore.markRead(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ success: true });
  });

  api.post("/assistant/news/mark-all-read", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const count = newsStore.markAllRead(body.category);
    return c.json({ markedRead: count });
  });

  api.patch("/assistant/news/:id/save", (c) => {
    const item = newsStore.toggleSaved(c.req.param("id"));
    if (!item) return c.json({ error: "not found" }, 404);
    return c.json(item);
  });

  // === TIME TRACKING ===
  api.get("/assistant/time/timer", (c) => {
    const timer = timeStore.getActiveTimer();
    return c.json({ timer });
  });

  api.post("/assistant/time/timer/start", async (c) => {
    const body = await c.req.json();
    if (!body.task) return c.json({ error: "task is required" }, 400);
    const timer = timeStore.startTimer(body.task, body.project, body.category);
    return c.json(timer, 201);
  });

  api.post("/assistant/time/timer/stop", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const entry = timeStore.stopTimer(body.notes);
    if (!entry) return c.json({ error: "no active timer" }, 400);
    return c.json(entry);
  });

  api.post("/assistant/time/log", async (c) => {
    const body = await c.req.json();
    if (!body.task || body.duration === undefined) {
      return c.json({ error: "task and duration are required" }, 400);
    }
    const entry = timeStore.logTime(body.task, body.duration, body.project, body.category, body.notes, body.date);
    return c.json(entry, 201);
  });

  api.get("/assistant/time/entries", (c) => {
    const startDate = c.req.query("start") || undefined;
    const endDate = c.req.query("end") || undefined;
    const project = c.req.query("project") || undefined;
    return c.json({ entries: timeStore.listEntries(startDate, endDate, project) });
  });

  api.get("/assistant/time/report", (c) => {
    const period = (c.req.query("period") || "week") as "today" | "week" | "month" | "custom";
    const start = c.req.query("start") || undefined;
    const end = c.req.query("end") || undefined;
    return c.json(timeStore.getReport(period, start, end));
  });

  api.get("/assistant/time/projects", (c) => {
    return c.json({ projects: timeStore.listProjects() });
  });

  api.delete("/assistant/time/entries/:id", (c) => {
    const ok = timeStore.deleteEntry(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ success: true });
  });

  api.patch("/assistant/time/entries/:id", async (c) => {
    const body = await c.req.json();
    const entry = timeStore.updateEntry(c.req.param("id"), body);
    if (!entry) return c.json({ error: "not found" }, 404);
    return c.json(entry);
  });
}
