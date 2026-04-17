// ─── Vector Store ───────────────────────────────────────────────────────────
// Wraps vectra LocalIndex for local semantic vector storage + migration from old Notes.

import { LocalIndex } from "vectra";
import { join } from "node:path";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { HEYHANK_HOME } from "./paths.js";

const INDEX_PATH = join(HEYHANK_HOME, "memory", "vector-index");
const MIGRATED_MARKER = join(HEYHANK_HOME, "memory", ".migrated");

let index: LocalIndex | null = null;

export interface VectorItem {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

async function ensureIndex(): Promise<LocalIndex> {
  if (index) return index;

  mkdirSync(INDEX_PATH, { recursive: true });
  const idx = new LocalIndex(INDEX_PATH);

  if (!await idx.isIndexCreated()) {
    await idx.createIndex();
  }

  index = idx;

  // Run migration from old notes if needed
  await migrateFromNotes();

  return index;
}

async function migrateFromNotes(): Promise<void> {
  if (existsSync(MIGRATED_MARKER)) return;

  const notesPath = join(HEYHANK_HOME, "assistant", "notes.json");
  if (!existsSync(notesPath)) {
    // No notes to migrate, mark as done
    mkdirSync(join(HEYHANK_HOME, "memory"), { recursive: true });
    writeFileSync(MIGRATED_MARKER, new Date().toISOString(), "utf-8");
    return;
  }

  try {
    const notes = JSON.parse(readFileSync(notesPath, "utf-8")) as Array<{
      id: string;
      title: string;
      content: string;
      tags: string[];
      createdAt: string;
    }>;

    const memoryNotes = notes.filter(
      (n) => n.tags?.includes("memory") || n.tags?.includes("hank-memory")
    );

    if (memoryNotes.length > 0) {
      console.log(`[vector-store] Migrating ${memoryNotes.length} memory notes to vector index...`);

      // Import embedding lazily to avoid circular deps
      const { getEmbedding } = await import("./embedding-service.js");

      for (const note of memoryNotes) {
        try {
          const embedding = await getEmbedding(note.content, "passage: ");
          await index!.insertItem({
            vector: embedding,
            metadata: {
              id: note.id,
              content: note.content,
              createdAt: note.createdAt,
            },
          });
        } catch {
          // If embedding fails, store with zero vector
          const zeroVector = new Array(384).fill(0);
          await index!.insertItem({
            vector: zeroVector,
            metadata: {
              id: note.id,
              content: note.content,
              createdAt: note.createdAt,
            },
          });
        }
      }
      console.log(`[vector-store] Migration complete.`);
    }
  } catch (err) {
    console.error("[vector-store] Migration error:", err);
  }

  writeFileSync(MIGRATED_MARKER, new Date().toISOString(), "utf-8");
}

export async function addItem(
  id: string,
  content: string,
  embedding: number[],
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const idx = await ensureIndex();
  await idx.insertItem({
    vector: embedding,
    metadata: { id, content, ...metadata },
  });
}

export async function searchByVector(embedding: number[], topK = 5): Promise<VectorItem[]> {
  const idx = await ensureIndex();
  const results = await idx.queryItems(embedding, "", topK);
  return results.map((r) => ({
    id: (r.item.metadata as Record<string, unknown>).id as string,
    content: (r.item.metadata as Record<string, unknown>).content as string,
    metadata: r.item.metadata as Record<string, unknown>,
  }));
}

export async function keywordSearch(query: string, limit = 5): Promise<VectorItem[]> {
  const idx = await ensureIndex();
  const allItems = await idx.listItems();
  const q = query.toLowerCase();
  const matches: VectorItem[] = [];

  for (const item of allItems) {
    const meta = item.metadata as Record<string, unknown>;
    const content = (meta.content as string) || "";
    if (content.toLowerCase().includes(q)) {
      matches.push({
        id: meta.id as string,
        content,
        metadata: meta,
      });
      if (matches.length >= limit) break;
    }
  }

  return matches;
}

export async function listAll(): Promise<VectorItem[]> {
  const idx = await ensureIndex();
  const allItems = await idx.listItems();
  return allItems.map((item) => {
    const meta = item.metadata as Record<string, unknown>;
    return {
      id: meta.id as string,
      content: (meta.content as string) || "",
      metadata: meta,
    };
  });
}

export async function deleteItem(id: string): Promise<boolean> {
  const idx = await ensureIndex();
  const allItems = await idx.listItems();
  for (const item of allItems) {
    const meta = item.metadata as Record<string, unknown>;
    if (meta.id === id) {
      await idx.deleteItem(item.id);
      return true;
    }
  }
  return false;
}

export async function rebuildFromVault(vaultMemoryDir: string): Promise<void> {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { parseFrontmatter } = await import("./vault-markdown.js");
  const { getEmbedding } = await import("./embedding-service.js");

  const files = readdirSync(vaultMemoryDir).filter(f => f.startsWith("memory-") && f.endsWith(".md"));
  if (files.length === 0) return;

  // Get existing indexed IDs to skip
  const existingItems = await listAll();
  const existingIds = new Set(existingItems.map(i => i.id));

  let indexed = 0;
  for (const file of files) {
    const id = file.replace(/^memory-/, "").replace(/\.md$/, "");
    if (existingIds.has(id)) continue;

    const content = readFileSync(join(vaultMemoryDir, file), "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    let embedding: number[];
    try {
      embedding = await getEmbedding(body, "passage: ");
    } catch {
      embedding = new Array(384).fill(0);
    }

    const metadata: Record<string, unknown> = {};
    if (frontmatter.createdAt) metadata.createdAt = frontmatter.createdAt;
    if (frontmatter.category) metadata.category = frontmatter.category;
    if (frontmatter.source) metadata.source = frontmatter.source;

    await addItem(id, body, embedding, metadata);
    indexed++;
  }

  if (indexed > 0) console.log(`[vector-store] Indexed ${indexed} new memories from vault`);
}
