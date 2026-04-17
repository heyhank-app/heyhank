// ─── Obsidian Vault Sync ─────────────────────────────────────────────────────
// Mirrors HeyHank memories as Markdown files in an Obsidian vault.
// Bi-directional: changes in either system sync to the other.

import { watch, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { FSWatcher } from "node:fs";
import { getSettings } from "./settings-manager.js";

const SUBFOLDER = "HeyHank";

// Track which writes we initiated to avoid re-importing our own changes
const pendingWrites = new Set<string>();
let watcher: FSWatcher | null = null;
let currentVaultPath = "";

// Callbacks for syncing changes back to memory service
let onExternalEdit: ((id: string, content: string) => Promise<void>) | null = null;
let onExternalDelete: ((id: string) => Promise<void>) | null = null;

function getVaultDir(): string | null {
  const vaultPath = getSettings().obsidianVaultPath;
  if (!vaultPath) return null;
  return join(vaultPath, SUBFOLDER);
}

function filenameForId(id: string): string {
  return `memory-${id}.md`;
}

function idFromFilename(filename: string): string | null {
  const match = filename.match(/^memory-(.+)\.md$/);
  return match ? match[1] : null;
}

/** Build markdown content from a memory */
function toMarkdown(content: string, metadata?: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  if (metadata?.createdAt) lines.push(`created: ${metadata.createdAt}`);
  if (metadata?.updatedAt) lines.push(`updated: ${metadata.updatedAt}`);
  if (metadata?.category) lines.push(`category: ${metadata.category}`);
  if (metadata?.source) lines.push(`source: ${metadata.source}`);
  lines.push("synced: true");
  lines.push("---");
  lines.push("");
  lines.push(content);
  return lines.join("\n");
}

/** Parse markdown back to content (strip frontmatter) */
function fromMarkdown(md: string): string {
  const fmMatch = md.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/);
  return fmMatch ? fmMatch[1].trim() : md.trim();
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Write a memory to the vault as a .md file */
export function syncToVault(id: string, content: string, metadata?: Record<string, unknown>): void {
  const dir = getVaultDir();
  if (!dir) return;

  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filepath = join(dir, filenameForId(id));
    const md = toMarkdown(content, metadata);
    pendingWrites.add(filenameForId(id));
    writeFileSync(filepath, md, "utf-8");
    // Clear pending after a short delay to allow watcher to see it
    setTimeout(() => pendingWrites.delete(filenameForId(id)), 500);
  } catch (err) {
    console.warn("[obsidian-sync] Failed to write:", err instanceof Error ? err.message : err);
  }
}

/** Remove a memory's .md file from the vault */
export function removeFromVault(id: string): void {
  const dir = getVaultDir();
  if (!dir) return;

  try {
    const filepath = join(dir, filenameForId(id));
    if (existsSync(filepath)) {
      pendingWrites.add(filenameForId(id));
      unlinkSync(filepath);
      setTimeout(() => pendingWrites.delete(filenameForId(id)), 500);
    }
  } catch (err) {
    console.warn("[obsidian-sync] Failed to delete:", err instanceof Error ? err.message : err);
  }
}

/** Start watching the vault subfolder for external changes */
export function startWatcher(
  onEdit: (id: string, content: string) => Promise<void>,
  onDelete: (id: string) => Promise<void>,
): void {
  stopWatcher();
  onExternalEdit = onEdit;
  onExternalDelete = onDelete;

  const dir = getVaultDir();
  if (!dir) return;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  currentVaultPath = dir;

  try {
    watcher = watch(dir, (eventType, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      if (pendingWrites.has(filename)) return; // Our own write, skip

      const id = idFromFilename(filename);
      if (!id) return;

      const filepath = join(dir, filename);

      // Small debounce to let file writes complete
      setTimeout(async () => {
        try {
          if (existsSync(filepath)) {
            const md = readFileSync(filepath, "utf-8");
            const content = fromMarkdown(md);
            if (content && onExternalEdit) {
              await onExternalEdit(id, content);
              console.log(`[obsidian-sync] Imported edit for memory ${id}`);
            }
          } else {
            // File was deleted externally
            if (onExternalDelete) {
              await onExternalDelete(id);
              console.log(`[obsidian-sync] Imported delete for memory ${id}`);
            }
          }
        } catch (err) {
          console.warn("[obsidian-sync] Watcher error:", err instanceof Error ? err.message : err);
        }
      }, 300);
    });
    console.log(`[obsidian-sync] Watching ${dir}`);
  } catch (err) {
    console.warn("[obsidian-sync] Failed to start watcher:", err instanceof Error ? err.message : err);
  }
}

/** Stop the file watcher */
export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    if (currentVaultPath) {
      console.log(`[obsidian-sync] Stopped watching ${currentVaultPath}`);
    }
    currentVaultPath = "";
  }
}

/** Export all existing memories to the vault (initial sync) */
export function bulkExportToVault(memories: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>): void {
  const dir = getVaultDir();
  if (!dir) return;

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let count = 0;
  for (const mem of memories) {
    try {
      const filepath = join(dir, filenameForId(mem.id));
      if (!existsSync(filepath)) {
        const md = toMarkdown(mem.content, mem.metadata);
        pendingWrites.add(filenameForId(mem.id));
        writeFileSync(filepath, md, "utf-8");
        setTimeout(() => pendingWrites.delete(filenameForId(mem.id)), 500);
        count++;
      }
    } catch { /* skip individual failures */ }
  }
  if (count > 0) console.log(`[obsidian-sync] Exported ${count} memories to vault`);
}

/** Check if Obsidian sync is enabled */
export function isEnabled(): boolean {
  return !!getSettings().obsidianVaultPath;
}
