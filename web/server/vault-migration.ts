// ─── Vault Migration ─────────────────────────────────────────────────────────
// One-time migration of JSON-based assistant data to Obsidian vault (.md files).
// Reads directly from ~/.heyhank/assistant/*.json (bypassing assistant-store to
// avoid vault delegation) and writes .md files using vault-markdown serializers.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";
import { getSettings } from "./settings-manager.js";
import * as md from "./vault-markdown.js";
import type { Todo, Note, Reminder, GeminiConversation } from "./assistant-store.js";

const ASSISTANT_DIR = join(HEYHANK_HOME, "assistant");
const MIGRATION_MARKER = join(ASSISTANT_DIR, ".migrated-to-vault");

/** Read a JSON file directly from the assistant directory (bypasses vault delegation). */
function readJsonFile<T>(filename: string, fallback: T): T {
  const filepath = join(ASSISTANT_DIR, filename);
  try {
    if (!existsSync(filepath)) return fallback;
    return JSON.parse(readFileSync(filepath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Write a file only if it doesn't already exist (idempotent migration). */
function writeIfNotExists(filepath: string, content: string): void {
  if (!existsSync(filepath)) writeFileSync(filepath, content, "utf-8");
}

/**
 * Migrate all JSON-based assistant data to the Obsidian vault.
 * This is idempotent: it writes a marker file after completion and
 * skips if the marker already exists. Individual files are also
 * written only if they don't already exist.
 */
export function migrateToVault(): void {
  const vaultPath = getSettings().obsidianVaultPath;
  if (!vaultPath) return;
  if (existsSync(MIGRATION_MARKER)) return;

  console.log("[vault-migration] Starting migration to Obsidian vault...");

  const vaultBase = join(vaultPath, "HeyHank");

  // ─── Todos ──────────────────────────────────────────────────────────────────
  try {
    const todos = readJsonFile<Todo[]>("todos.json", []);
    if (todos.length > 0) {
      const todosDir = join(vaultBase, "Todos");
      ensureDir(todosDir);
      for (const todo of todos) {
        writeIfNotExists(join(todosDir, `todo-${todo.id}.md`), md.todoToMarkdown(todo));
      }
      console.log(`[vault-migration] Migrated ${todos.length} todos`);
    }
  } catch (e) {
    console.warn("[vault-migration] Todos:", e);
  }

  // ─── Notes ──────────────────────────────────────────────────────────────────
  try {
    const notes = readJsonFile<Note[]>("notes.json", []);
    if (notes.length > 0) {
      const notesDir = join(vaultBase, "Notes");
      ensureDir(notesDir);
      for (const note of notes) {
        writeIfNotExists(join(notesDir, `note-${note.id}.md`), md.noteToMarkdown(note));
      }
      console.log(`[vault-migration] Migrated ${notes.length} notes`);
    }
  } catch (e) {
    console.warn("[vault-migration] Notes:", e);
  }

  // ─── Reminders ──────────────────────────────────────────────────────────────
  try {
    const reminders = readJsonFile<Reminder[]>("reminders.json", []);
    if (reminders.length > 0) {
      const remindersDir = join(vaultBase, "Reminders");
      ensureDir(remindersDir);
      for (const reminder of reminders) {
        writeIfNotExists(
          join(remindersDir, `reminder-${reminder.id}.md`),
          md.reminderToMarkdown(reminder),
        );
      }
      console.log(`[vault-migration] Migrated ${reminders.length} reminders`);
    }
  } catch (e) {
    console.warn("[vault-migration] Reminders:", e);
  }

  // ─── Conversations ──────────────────────────────────────────────────────────
  try {
    const convos = readJsonFile<GeminiConversation[]>("gemini-conversations.json", []);
    if (convos.length > 0) {
      const convosDir = join(vaultBase, "Conversations");
      ensureDir(convosDir);
      for (const convo of convos) {
        writeIfNotExists(
          join(convosDir, `convo-${convo.id}.md`),
          md.conversationToMarkdown(convo),
        );
      }
      console.log(`[vault-migration] Migrated ${convos.length} conversations`);
    }
  } catch (e) {
    console.warn("[vault-migration] Conversations:", e);
  }

  // ─── Mark complete ──────────────────────────────────────────────────────────
  ensureDir(ASSISTANT_DIR);
  writeFileSync(MIGRATION_MARKER, new Date().toISOString(), "utf-8");
  console.log("[vault-migration] Migration complete!");
}
