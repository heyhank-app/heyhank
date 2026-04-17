// ─── Vault Watcher ───────────────────────────────────────────────────────────
// Watches the Memory/ subfolder for external edits (e.g. from Obsidian)
// and re-indexes changed files in Vectra.

import { watch, existsSync, readFileSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./vault-markdown.js";

const pendingWrites = new Set<string>();
let watcher: FSWatcher | null = null;

export function markPendingWrite(filename: string): void {
  pendingWrites.add(filename);
  setTimeout(() => pendingWrites.delete(filename), 500);
}

export function startMemoryWatcher(
  memoryDir: string,
  onEdit: (id: string, content: string) => Promise<void>,
  onDelete: (id: string) => Promise<void>,
): void {
  stopMemoryWatcher();
  if (!existsSync(memoryDir)) return;

  try {
    watcher = watch(memoryDir, (eventType, filename) => {
      if (!filename || !filename.startsWith("memory-") || !filename.endsWith(".md")) return;
      if (pendingWrites.has(filename)) return;

      const id = filename.replace(/^memory-/, "").replace(/\.md$/, "");
      const filepath = join(memoryDir, filename);

      setTimeout(async () => {
        try {
          if (existsSync(filepath)) {
            const raw = readFileSync(filepath, "utf-8");
            const { body } = parseFrontmatter(raw);
            if (body) await onEdit(id, body);
          } else {
            await onDelete(id);
          }
        } catch (err) {
          console.warn("[vault-watcher] Error:", err instanceof Error ? err.message : err);
        }
      }, 300);
    });
    console.log(`[vault-watcher] Watching ${memoryDir}`);
  } catch (err) {
    console.warn("[vault-watcher] Failed to start:", err instanceof Error ? err.message : err);
  }
}

export function stopMemoryWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
