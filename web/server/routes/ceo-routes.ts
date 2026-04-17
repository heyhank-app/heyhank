import { Hono } from "hono";
import * as docStore from "../ceo/document-store.js";
import * as templateStore from "../ceo/template-store.js";

export function registerCeoDocumentRoutes(api: Hono) {
  // Documents
  api.get("/assistant/documents", (c) => {
    const folder = c.req.query("folder") || undefined;
    const tag = c.req.query("tag") || undefined;
    return c.json({ documents: docStore.listDocuments(folder, tag) });
  });

  api.post("/assistant/documents", async (c) => {
    const body = await c.req.json();
    if (!body.title || !body.content || !body.fileType) {
      return c.json({ error: "title, content, and fileType are required" }, 400);
    }
    const doc = docStore.addDocument(body.title, body.content, body.fileType, body.folder, body.tags, body.summary);
    return c.json(doc, 201);
  });

  api.get("/assistant/documents/search", (c) => {
    const query = c.req.query("q") || "";
    return c.json({ documents: docStore.searchDocuments(query) });
  });

  api.get("/assistant/documents/folders", (c) => {
    return c.json({ folders: docStore.listFolders() });
  });

  api.get("/assistant/documents/:id", (c) => {
    const result = docStore.getDocument(c.req.param("id"));
    if (!result) return c.json({ error: "not found" }, 404);
    return c.json(result);
  });

  api.patch("/assistant/documents/:id", async (c) => {
    const body = await c.req.json();
    const doc = docStore.updateDocument(c.req.param("id"), body);
    if (!doc) return c.json({ error: "not found" }, 404);
    return c.json(doc);
  });

  api.delete("/assistant/documents/:id", (c) => {
    const ok = docStore.deleteDocument(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ success: true });
  });

  // Templates
  api.get("/assistant/templates", (c) => {
    const category = c.req.query("category") || undefined;
    return c.json({ templates: templateStore.listTemplates(category) });
  });

  api.post("/assistant/templates", async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.content || !body.category) {
      return c.json({ error: "name, content, and category are required" }, 400);
    }
    const tpl = templateStore.createTemplate(body.name, body.content, body.category, body.variables, body.tags);
    return c.json(tpl, 201);
  });

  api.get("/assistant/templates/search", (c) => {
    const query = c.req.query("q") || "";
    return c.json({ templates: templateStore.searchTemplates(query) });
  });

  api.get("/assistant/templates/categories", (c) => {
    return c.json({ categories: templateStore.listCategories() });
  });

  api.get("/assistant/templates/:id", (c) => {
    const tpl = templateStore.getTemplate(c.req.param("id"));
    if (!tpl) return c.json({ error: "not found" }, 404);
    return c.json(tpl);
  });

  api.patch("/assistant/templates/:id", async (c) => {
    const body = await c.req.json();
    const tpl = templateStore.updateTemplate(c.req.param("id"), body);
    if (!tpl) return c.json({ error: "not found" }, 404);
    return c.json(tpl);
  });

  api.delete("/assistant/templates/:id", (c) => {
    const ok = templateStore.deleteTemplate(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ success: true });
  });

  api.post("/assistant/templates/:id/use", async (c) => {
    const body = await c.req.json();
    const result = templateStore.useTemplate(c.req.param("id"), body.variables || {});
    if (!result) return c.json({ error: "not found" }, 404);
    return c.json(result);
  });
}
