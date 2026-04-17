// ─── Memory Service ─────────────────────────────────────────────────────────
// 100% local semantic memory using vectra + transformers.js embeddings.
// When obsidianVaultPath is set, vault .md files are the primary store
// and Vectra becomes a search-only index rebuilt from vault files.

import { getEmbedding, isEmbeddingReady } from "./embedding-service.js";
import * as vectorStore from "./vector-store.js";
import { getSettings } from "./settings-manager.js";
import * as vaultMd from "./vault-markdown.js";
import { markPendingWrite } from "./vault-watcher.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Memory {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Vault Helpers ──────────────────────────────────────────────────────────

function getMemoryDir(): string | null {
  const vaultPath = getSettings().obsidianVaultPath;
  if (!vaultPath) return null;
  const dir = join(vaultPath, "HeyHank", "Memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function addMemory(content: string, metadata?: Record<string, unknown>): Promise<Memory> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const meta = { ...metadata, createdAt };

  // Write to vault if configured (primary store)
  const dir = getMemoryDir();
  if (dir) {
    const memObj: vaultMd.Memory = {
      id,
      content,
      createdAt,
      updatedAt: createdAt,
      category: metadata?.category as string | undefined,
      source: metadata?.source as string | undefined,
    };
    markPendingWrite(`memory-${id}.md`);
    writeFileSync(join(dir, `memory-${id}.md`), vaultMd.memoryToMarkdown(memObj), "utf-8");
  }

  // Index in Vectra (search index)
  let embedding: number[];
  try {
    embedding = await getEmbedding(content, "passage: ");
  } catch (err) {
    console.log(`[memory] Embedding failed, storing with zero vector: ${err}`);
    embedding = new Array(384).fill(0);
  }
  await vectorStore.addItem(id, content, embedding, meta);

  return { id, content, metadata, createdAt };
}

export async function searchMemories(query: string, limit = 5): Promise<Memory[]> {
  try {
    const embedding = await getEmbedding(query, "query: ");
    const results = await vectorStore.searchByVector(embedding, limit);
    return results.map(toMemory);
  } catch (err) {
    console.log(`[memory] Semantic search failed, falling back to keyword: ${err}`);
    const results = await vectorStore.keywordSearch(query, limit);
    return results.map(toMemory);
  }
}

export async function listMemories(limit = 50): Promise<Memory[]> {
  const dir = getMemoryDir();
  if (dir) {
    // Read from vault (primary)
    const files = readdirSync(dir).filter(f => f.startsWith("memory-") && f.endsWith(".md"));
    const memories: Memory[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), "utf-8");
        const mem = vaultMd.markdownToMemory(raw);
        memories.push({
          id: mem.id,
          content: mem.content,
          metadata: {
            createdAt: mem.createdAt,
            ...(mem.category ? { category: mem.category } : {}),
            ...(mem.source ? { source: mem.source } : {}),
          },
          createdAt: mem.createdAt,
          updatedAt: mem.updatedAt || undefined,
        });
      } catch { /* skip malformed files */ }
    }
    return memories
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      })
      .slice(0, limit);
  }

  // Fallback: read from Vectra
  const items = await vectorStore.listAll();
  return items
    .map(toMemory)
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    })
    .slice(0, limit);
}

export async function updateMemory(id: string, content: string, metadata?: Record<string, unknown>): Promise<Memory | null> {
  const dir = getMemoryDir();
  const updatedAt = new Date().toISOString();

  if (dir) {
    // Update in vault (primary)
    const filepath = join(dir, `memory-${id}.md`);
    if (!existsSync(filepath)) return null;
    const oldRaw = readFileSync(filepath, "utf-8");
    const oldMem = vaultMd.markdownToMemory(oldRaw);
    const memObj: vaultMd.Memory = {
      id,
      content,
      createdAt: oldMem.createdAt,
      updatedAt,
      category: (metadata?.category as string | undefined) || oldMem.category,
      source: (metadata?.source as string | undefined) || oldMem.source,
    };
    markPendingWrite(`memory-${id}.md`);
    writeFileSync(filepath, vaultMd.memoryToMarkdown(memObj), "utf-8");

    // Re-index in Vectra
    const mergedMeta = { ...metadata, createdAt: oldMem.createdAt, updatedAt };
    let embedding: number[];
    try { embedding = await getEmbedding(content, "passage: "); } catch { embedding = new Array(384).fill(0); }
    await vectorStore.deleteItem(id);
    await vectorStore.addItem(id, content, embedding, mergedMeta);

    return { id, content, metadata: mergedMeta, createdAt: oldMem.createdAt, updatedAt };
  }

  // Fallback: original Vectra-only logic
  const items = await vectorStore.listAll();
  const existing = items.find(i => i.id === id);
  if (!existing) return null;
  const mergedMeta = { ...existing.metadata, ...metadata, updatedAt };
  let embedding: number[];
  try { embedding = await getEmbedding(content, "passage: "); } catch { embedding = new Array(384).fill(0); }
  await vectorStore.deleteItem(id);
  await vectorStore.addItem(id, content, embedding, mergedMeta);
  return { id, content, metadata: mergedMeta, createdAt: (mergedMeta as Record<string, unknown>).createdAt as string | undefined, updatedAt };
}

export async function deleteMemory(id: string): Promise<boolean> {
  const dir = getMemoryDir();
  if (dir) {
    const filepath = join(dir, `memory-${id}.md`);
    try {
      if (existsSync(filepath)) {
        markPendingWrite(`memory-${id}.md`);
        unlinkSync(filepath);
      }
    } catch { /* ignore */ }
  }
  return vectorStore.deleteItem(id);
}

/** Get relevant memory context for a user message (for system prompt injection) */
export async function getContextForMessage(message: string): Promise<string> {
  try {
    const memories = await searchMemories(message, 5);
    if (memories.length === 0) return "";
    return `\nUSER MEMORY (known facts about the user):\n${memories.map(m => `- ${m.content}`).join("\n")}\nUse this context to personalize your responses.`;
  } catch {
    return "";
  }
}

/** Memory is always configured — no external API key needed */
export function isMemoryConfigured(): boolean {
  return true;
}

/** Returns "semantic" when embedding model is loaded, "local-keyword" otherwise */
export function getBackendName(): string {
  return isEmbeddingReady() ? "semantic" : "local-keyword";
}

// ─── Auto-Detection ─────────────────────────────────────────────────────────

export interface DetectedFact {
  fact: string;
  category: string;
}

/**
 * Extract memorable facts from a conversation using an LLM.
 * Returns only genuinely new facts (deduplicated against existing memories).
 */
export async function detectMemorableFacts(
  messages: Array<{ role: string; content: string }>,
  llmCall: (systemPrompt: string, userPrompt: string) => Promise<string>,
): Promise<DetectedFact[]> {
  // Only process conversations with at least 1 user message
  const userMessages = messages.filter(m => m.role === "user");
  if (userMessages.length === 0) return [];

  // Get existing memories to avoid duplicates
  const existing = await listMemories(100);
  const existingFacts = existing.map(m => m.content).join("\n- ");

  const systemPrompt = `You extract personal facts about the user from conversations.
Return ONLY a JSON array of objects with "fact" and "category" fields.
Categories: preference, personal, technical, habit, schedule, contact
Rules:
- Only extract FACTS the user explicitly stated about themselves
- Skip greetings, questions, commands, and transient requests
- Skip facts that are already known (see EXISTING below)
- Keep facts concise (one sentence max)
- Return [] if no new facts found
EXISTING MEMORIES:
${existingFacts ? `- ${existingFacts}` : "(none)"}`;

  const conversationText = messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .slice(-10) // last 10 messages max
    .map(m => `${m.role}: ${m.content}`)
    .join("\n");

  const userPrompt = `Extract new personal facts from this conversation:\n\n${conversationText}\n\nRespond with ONLY a JSON array, no markdown.`;

  try {
    const response = await llmCall(systemPrompt, userPrompt);
    // Parse JSON from response (handle markdown code fences)
    const cleaned = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f: any) => f.fact && f.category && typeof f.fact === "string");
  } catch {
    return [];
  }
}

// ─── Vault Sync ─────────────────────────────────────────────────────────────

/** Initialize vault sync — call once at server startup */
export async function initVaultSync(): Promise<void> {
  const dir = getMemoryDir();
  if (!dir) return;

  // Rebuild Vectra index from vault files (for memories not yet indexed)
  await vectorStore.rebuildFromVault(dir);

  // Start file watcher for Memory/ subfolder only
  const { startMemoryWatcher } = await import("./vault-watcher.js");
  startMemoryWatcher(dir, async (id, content) => {
    // External edit — re-index in Vectra
    let embedding: number[];
    try { embedding = await getEmbedding(content, "passage: "); } catch { embedding = new Array(384).fill(0); }
    await vectorStore.deleteItem(id);
    await vectorStore.addItem(id, content, embedding, {});
  }, async (id) => {
    // External delete — remove from Vectra
    await vectorStore.deleteItem(id);
  });
}

/** Restart vault sync (called when settings change) */
export async function restartVaultSync(): Promise<void> {
  const { stopMemoryWatcher } = await import("./vault-watcher.js");
  stopMemoryWatcher();
  await initVaultSync();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toMemory(item: vectorStore.VectorItem): Memory {
  return {
    id: item.id,
    content: item.content,
    metadata: item.metadata,
    createdAt: item.metadata?.createdAt as string | undefined,
  };
}
