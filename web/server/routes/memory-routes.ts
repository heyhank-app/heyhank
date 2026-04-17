// ─── Memory Routes ──────────────────────────────────────────────────────────
// REST API for memory CRUD + search

import type { Hono } from "hono";
import * as memoryService from "../memory-service.js";

export function registerMemoryRoutes(api: Hono): void {
  // List all memories
  api.get("/memory", async (c) => {
    try {
      const memories = await memoryService.listMemories();
      return c.json({ memories, count: memories.length, backend: memoryService.getBackendName() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to list memories" }, 500);
    }
  });

  // Search memories
  api.get("/memory/search", async (c) => {
    const query = c.req.query("q") || "";
    if (!query) return c.json({ error: "q parameter required" }, 400);
    try {
      const memories = await memoryService.searchMemories(query);
      return c.json({ memories, count: memories.length });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Search failed" }, 500);
    }
  });

  // Get context for a message
  api.post("/memory/context", async (c) => {
    const body = await c.req.json().catch(() => ({} as { message?: string }));
    if (!body.message) return c.json({ error: "message required" }, 400);
    const context = await memoryService.getContextForMessage(body.message);
    return c.json({ context });
  });

  // Add a memory
  api.post("/memory", async (c) => {
    const body = await c.req.json().catch(() => ({} as { content?: string; metadata?: Record<string, unknown> }));
    if (!body.content) return c.json({ error: "content required" }, 400);
    try {
      const memory = await memoryService.addMemory(body.content, body.metadata);
      return c.json({ memory, message: "Memory saved." });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to save memory" }, 500);
    }
  });

  // Update a memory
  api.put("/memory/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({} as { content?: string; metadata?: Record<string, unknown> }));
    if (!body.content) return c.json({ error: "content required" }, 400);
    try {
      const memory = await memoryService.updateMemory(id, body.content, body.metadata);
      if (!memory) return c.json({ error: "Memory not found." }, 404);
      return c.json({ memory, message: "Memory updated." });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to update memory" }, 500);
    }
  });

  // Delete a memory
  api.delete("/memory/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const ok = await memoryService.deleteMemory(id);
      return c.json({ ok, message: ok ? "Memory deleted." : "Memory not found." });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to delete memory" }, 500);
    }
  });

  // Import: detect platform
  api.post("/memory/import/detect", async (c) => {
    try {
      const body = await c.req.json();
      const { detectPlatform } = await import("../ceo/memory-import.js");
      const platform = detectPlatform(body.data);
      return c.json({ platform });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Detection failed" }, 400);
    }
  });

  // Import: process and save memories
  api.post("/memory/import", async (c) => {
    try {
      const body = await c.req.json();
      const { data, platform: platformOverride, options } = body;
      if (!data) return c.json({ error: "data is required" }, 400);

      const { detectPlatform, processImport } = await import("../ceo/memory-import.js");
      const platform = platformOverride || detectPlatform(data);
      const importOptions = {
        mode: options?.mode || "both",
        extractFacts: options?.extractFacts !== false,
        maxConversations: options?.maxConversations || 500,
      };

      const result = processImport(data, platform, importOptions);

      // Save extracted memories
      let saved = 0;
      for (const content of result.memories) {
        try {
          await memoryService.addMemory(content, {
            source: `import-${platform}`,
            category: "imported",
          });
          saved++;
        } catch {
          result.errors.push(`Failed to save: ${content.slice(0, 50)}...`);
        }
      }

      return c.json({
        ...result,
        saved,
        message: `Imported ${saved} memories from ${platform}. ${result.conversations} conversations processed, ${result.messagesProcessed} messages scanned.`,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Import failed" }, 500);
    }
  });
}
