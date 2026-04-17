// ─── Vault Store ─────────────────────────────────────────────────────────────
// Filesystem-backed data store using Obsidian vault as primary storage.
// Each entity type maps to a subfolder in {vault}/HeyHank/.
// When obsidianVaultPath is configured, this replaces the JSON-based assistant-store.

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { getSettings } from "./settings-manager.js";
import * as md from "./vault-markdown.js";
import type { Todo, Note, Reminder, GeminiConversation, Contact, ContactInteraction, Decision } from "./assistant-store.js";
import type { CallData } from "./vault-markdown.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDir(subfolder: string): string | null {
  const vaultPath = getSettings().obsidianVaultPath;
  if (!vaultPath) return null;
  const dir = join(vaultPath, "HeyHank", subfolder);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function readAllMd(dir: string, prefix: string): Array<{ filename: string; content: string }> {
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".md"))
    .map((f) => ({ filename: f, content: readFileSync(join(dir, f), "utf-8") }));
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Atomic write: write to .tmp then rename */
function atomicWrite(filepath: string, content: string): void {
  const tmp = filepath + ".tmp";
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, filepath);
}

function filenameForId(prefix: string, id: string): string {
  return `${prefix}${id}.md`;
}

function findFile(dir: string, prefix: string, id: string): string | null {
  const filepath = join(dir, filenameForId(prefix, id));
  return existsSync(filepath) ? filepath : null;
}

// ─── Todos ───────────────────────────────────────────────────────────────────

export function listTodos(filter?: { done?: boolean; priority?: string; category?: string }): Todo[] {
  const dir = getDir("Todos");
  if (!dir) return [];
  const files = readAllMd(dir, "todo-");
  const todos = files.map((f) => md.markdownToTodo(f.content));
  return todos.filter((t) => {
    if (filter?.done !== undefined && t.done !== filter.done) return false;
    if (filter?.priority && t.priority !== filter.priority) return false;
    if (filter?.category && t.category !== filter.category) return false;
    return true;
  });
}

export function addTodo(text: string, priority: string = "medium", category?: string, extra?: { delegatedTo?: string; dueDate?: string; followUpDate?: string; project?: string }): Todo {
  const dir = getDir("Todos");
  if (!dir) throw new Error("Obsidian vault not configured");
  const todo: Todo = {
    id: genId(),
    text,
    priority: (["high", "medium", "low"].includes(priority) ? priority : "medium") as Todo["priority"],
    done: false,
    createdAt: new Date().toISOString(),
    category,
    ...extra,
  };
  atomicWrite(join(dir, filenameForId("todo-", todo.id)), md.todoToMarkdown(todo));
  return todo;
}

export function completeTodo(id: string): Todo | null {
  const dir = getDir("Todos");
  if (!dir) return null;
  const filepath = findFile(dir, "todo-", id);
  if (!filepath) return null;
  const todo = md.markdownToTodo(readFileSync(filepath, "utf-8"));
  todo.done = true;
  todo.doneAt = new Date().toISOString();
  atomicWrite(filepath, md.todoToMarkdown(todo));
  return todo;
}

export function updateTodo(id: string, updates: { text?: string; priority?: string; category?: string; done?: boolean; delegatedTo?: string; dueDate?: string; followUpDate?: string; project?: string }): Todo | null {
  const dir = getDir("Todos");
  if (!dir) return null;
  const filepath = findFile(dir, "todo-", id);
  if (!filepath) return null;
  const todo = md.markdownToTodo(readFileSync(filepath, "utf-8"));
  if (updates.text) todo.text = updates.text;
  if (updates.priority && ["high", "medium", "low"].includes(updates.priority)) {
    todo.priority = updates.priority as Todo["priority"];
  }
  if (updates.category !== undefined) todo.category = updates.category;
  if (updates.delegatedTo !== undefined) todo.delegatedTo = updates.delegatedTo;
  if (updates.dueDate !== undefined) todo.dueDate = updates.dueDate;
  if (updates.followUpDate !== undefined) todo.followUpDate = updates.followUpDate;
  if (updates.project !== undefined) todo.project = updates.project;
  if (updates.done === true && !todo.done) {
    todo.done = true;
    todo.doneAt = new Date().toISOString();
  } else if (updates.done === false) {
    todo.done = false;
    todo.doneAt = undefined;
  }
  atomicWrite(filepath, md.todoToMarkdown(todo));
  return todo;
}

export function deleteTodo(id: string): boolean {
  const dir = getDir("Todos");
  if (!dir) return false;
  const filepath = findFile(dir, "todo-", id);
  if (!filepath) return false;
  unlinkSync(filepath);
  return true;
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export function listNotes(search?: string): Note[] {
  const dir = getDir("Notes");
  if (!dir) return [];
  const files = readAllMd(dir, "note-");
  const notes = files.map((f) => md.markdownToNote(f.content));
  if (!search) return notes;
  const q = search.toLowerCase();
  return notes.filter((n) =>
    n.title.toLowerCase().includes(q) ||
    n.content.toLowerCase().includes(q) ||
    n.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export function addNote(title: string, content: string = "", tags: string[] = []): Note {
  const dir = getDir("Notes");
  if (!dir) throw new Error("Obsidian vault not configured");
  const note: Note = {
    id: genId(),
    title,
    content,
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  atomicWrite(join(dir, filenameForId("note-", note.id)), md.noteToMarkdown(note));
  return note;
}

export function getNote(id: string): Note | null {
  const dir = getDir("Notes");
  if (!dir) return null;
  const filepath = findFile(dir, "note-", id);
  if (!filepath) return null;
  return md.markdownToNote(readFileSync(filepath, "utf-8"));
}

export function updateNote(id: string, updates: { title?: string; content?: string; tags?: string[] }): Note | null {
  const dir = getDir("Notes");
  if (!dir) return null;
  const filepath = findFile(dir, "note-", id);
  if (!filepath) return null;
  const note = md.markdownToNote(readFileSync(filepath, "utf-8"));
  if (updates.title) note.title = updates.title;
  if (updates.content) note.content = updates.content;
  if (updates.tags) note.tags = updates.tags;
  note.updatedAt = new Date().toISOString();
  atomicWrite(filepath, md.noteToMarkdown(note));
  return note;
}

export function deleteNote(id: string): boolean {
  const dir = getDir("Notes");
  if (!dir) return false;
  const filepath = findFile(dir, "note-", id);
  if (!filepath) return false;
  unlinkSync(filepath);
  return true;
}

// ─── Reminders ───────────────────────────────────────────────────────────────

export function listReminders(includeFired = false): Reminder[] {
  const dir = getDir("Reminders");
  if (!dir) return [];
  const files = readAllMd(dir, "reminder-");
  const reminders = files.map((f) => md.markdownToReminder(f.content));
  return includeFired ? reminders : reminders.filter((r) => !r.fired);
}

export function addReminder(text: string, triggerAt: string, calendarEventUid?: string): Reminder {
  const dir = getDir("Reminders");
  if (!dir) throw new Error("Obsidian vault not configured");
  const reminder: Reminder = {
    id: genId(),
    text,
    triggerAt,
    fired: false,
    createdAt: new Date().toISOString(),
    ...(calendarEventUid ? { calendarEventUid } : {}),
  };
  atomicWrite(join(dir, filenameForId("reminder-", reminder.id)), md.reminderToMarkdown(reminder));
  return reminder;
}

export function updateReminder(id: string, updates: { text?: string; triggerAt?: string; calendarEventUid?: string }): Reminder | null {
  const dir = getDir("Reminders");
  if (!dir) return null;
  const filepath = findFile(dir, "reminder-", id);
  if (!filepath) return null;
  const reminder = md.markdownToReminder(readFileSync(filepath, "utf-8"));
  if (updates.text !== undefined) reminder.text = updates.text;
  if (updates.triggerAt !== undefined) reminder.triggerAt = updates.triggerAt;
  if (updates.calendarEventUid !== undefined) reminder.calendarEventUid = updates.calendarEventUid;
  atomicWrite(filepath, md.reminderToMarkdown(reminder));
  return reminder;
}

export function fireReminder(id: string): Reminder | null {
  const dir = getDir("Reminders");
  if (!dir) return null;
  const filepath = findFile(dir, "reminder-", id);
  if (!filepath) return null;
  const reminder = md.markdownToReminder(readFileSync(filepath, "utf-8"));
  reminder.fired = true;
  atomicWrite(filepath, md.reminderToMarkdown(reminder));
  return reminder;
}

export function deleteReminder(id: string): boolean {
  const dir = getDir("Reminders");
  if (!dir) return false;
  const filepath = findFile(dir, "reminder-", id);
  if (!filepath) return false;
  unlinkSync(filepath);
  return true;
}

export function getDueReminders(): Reminder[] {
  const now = new Date().toISOString();
  const dir = getDir("Reminders");
  if (!dir) return [];
  const files = readAllMd(dir, "reminder-");
  const reminders = files.map((f) => md.markdownToReminder(f.content));
  return reminders.filter((r) => !r.fired && r.triggerAt <= now);
}

// ─── Conversations ───────────────────────────────────────────────────────────

export function listGeminiConversations(): GeminiConversation[] {
  const dir = getDir("Conversations");
  if (!dir) return [];
  const files = readAllMd(dir, "convo-");
  return files
    .map((f) => md.markdownToConversation(f.content))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function saveGeminiConversation(
  messages: Array<{ role: string; text: string; ts: number }>,
  duration?: number,
): GeminiConversation {
  const dir = getDir("Conversations");
  if (!dir) throw new Error("Obsidian vault not configured");
  const firstUser = messages.find((m) => m.role === "user");
  const title = firstUser ? firstUser.text.slice(0, 50) : "Gemini conversation";
  const convo: GeminiConversation = {
    id: genId(),
    title,
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "gemini" | "system", text: m.text, ts: m.ts })),
    createdAt: new Date().toISOString(),
    duration,
  };
  atomicWrite(join(dir, filenameForId("convo-", convo.id)), md.conversationToMarkdown(convo));

  // Enforce limit of 100 conversations: delete oldest if over
  const allFiles = readdirSync(dir)
    .filter((f) => f.startsWith("convo-") && f.endsWith(".md"))
    .sort(); // lexicographic sort — oldest first since filenames contain timestamp-based IDs
  if (allFiles.length > 100) {
    const toRemove = allFiles.slice(0, allFiles.length - 100);
    for (const f of toRemove) {
      try {
        unlinkSync(join(dir, f));
      } catch { /* ignore cleanup errors */ }
    }
  }

  return convo;
}

export function getGeminiConversation(id: string): GeminiConversation | null {
  const dir = getDir("Conversations");
  if (!dir) return null;
  const filepath = findFile(dir, "convo-", id);
  if (!filepath) return null;
  return md.markdownToConversation(readFileSync(filepath, "utf-8"));
}

export function deleteGeminiConversation(id: string): boolean {
  const dir = getDir("Conversations");
  if (!dir) return false;
  const filepath = findFile(dir, "convo-", id);
  if (!filepath) return false;
  unlinkSync(filepath);
  return true;
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export function syncCallToVault(call: CallData): void {
  const dir = getDir("Calls");
  if (!dir) return;
  atomicWrite(join(dir, filenameForId("call-", call.id)), md.callToMarkdown(call));
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export function listContacts(search?: string): Contact[] {
  const dir = getDir("Contacts");
  if (!dir) return [];
  const files = readAllMd(dir, "contact-");
  const contacts = files.map((f) => md.markdownToContact(f.content));
  if (!search) return contacts;
  const q = search.toLowerCase();
  return contacts.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    (c.company && c.company.toLowerCase().includes(q)) ||
    (c.email && c.email.toLowerCase().includes(q)) ||
    (c.phone && c.phone.includes(q)) ||
    c.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export function addContact(name: string, company?: string, email?: string, phone?: string, notes?: string, tags: string[] = []): Contact {
  const dir = getDir("Contacts");
  if (!dir) throw new Error("Obsidian vault not configured");
  const contact: Contact = {
    id: genId(),
    name,
    company,
    email,
    phone,
    notes,
    tags,
    interactions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  atomicWrite(join(dir, filenameForId("contact-", contact.id)), md.contactToMarkdown(contact));
  return contact;
}

export function getContact(id: string): Contact | null {
  const dir = getDir("Contacts");
  if (!dir) return null;
  const filepath = findFile(dir, "contact-", id);
  if (!filepath) return null;
  return md.markdownToContact(readFileSync(filepath, "utf-8"));
}

export function updateContact(id: string, updates: { name?: string; company?: string; email?: string; phone?: string; notes?: string; tags?: string[] }): Contact | null {
  const dir = getDir("Contacts");
  if (!dir) return null;
  const filepath = findFile(dir, "contact-", id);
  if (!filepath) return null;
  const contact = md.markdownToContact(readFileSync(filepath, "utf-8"));
  if (updates.name) contact.name = updates.name;
  if (updates.company !== undefined) contact.company = updates.company;
  if (updates.email !== undefined) contact.email = updates.email;
  if (updates.phone !== undefined) contact.phone = updates.phone;
  if (updates.notes !== undefined) contact.notes = updates.notes;
  if (updates.tags) contact.tags = updates.tags;
  contact.updatedAt = new Date().toISOString();
  atomicWrite(filepath, md.contactToMarkdown(contact));
  return contact;
}

export function deleteContact(id: string): boolean {
  const dir = getDir("Contacts");
  if (!dir) return false;
  const filepath = findFile(dir, "contact-", id);
  if (!filepath) return false;
  unlinkSync(filepath);
  return true;
}

export function logInteraction(contactId: string, interaction: Omit<ContactInteraction, "date">): Contact | null {
  const dir = getDir("Contacts");
  if (!dir) return null;
  const filepath = findFile(dir, "contact-", contactId);
  if (!filepath) return null;
  const contact = md.markdownToContact(readFileSync(filepath, "utf-8"));
  const entry: ContactInteraction = {
    date: new Date().toISOString(),
    type: interaction.type,
    summary: interaction.summary,
  };
  contact.interactions.push(entry);
  contact.lastContactDate = entry.date;
  contact.updatedAt = new Date().toISOString();
  atomicWrite(filepath, md.contactToMarkdown(contact));
  return contact;
}

// ─── Decisions ────────────────────────────────────────────────────────────────

export function listDecisions(search?: string): Decision[] {
  const dir = getDir("Decisions");
  if (!dir) return [];
  const files = readAllMd(dir, "decision-");
  const decisions = files.map((f) => md.markdownToDecision(f.content));
  if (!search) return decisions;
  const q = search.toLowerCase();
  return decisions.filter((d) =>
    d.title.toLowerCase().includes(q) ||
    d.context.toLowerCase().includes(q) ||
    d.decision.toLowerCase().includes(q) ||
    d.reasoning.toLowerCase().includes(q) ||
    d.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export function addDecision(title: string, context: string, decision: string, alternatives: string[] = [], reasoning: string = "", tags: string[] = []): Decision {
  const dir = getDir("Decisions");
  if (!dir) throw new Error("Obsidian vault not configured");
  const entry: Decision = {
    id: genId(),
    title,
    context,
    decision,
    alternatives,
    reasoning,
    tags,
    createdAt: new Date().toISOString(),
  };
  atomicWrite(join(dir, filenameForId("decision-", entry.id)), md.decisionToMarkdown(entry));
  return entry;
}

export function getDecision(id: string): Decision | null {
  const dir = getDir("Decisions");
  if (!dir) return null;
  const filepath = findFile(dir, "decision-", id);
  if (!filepath) return null;
  return md.markdownToDecision(readFileSync(filepath, "utf-8"));
}

export function deleteDecision(id: string): boolean {
  const dir = getDir("Decisions");
  if (!dir) return false;
  const filepath = findFile(dir, "decision-", id);
  if (!filepath) return false;
  unlinkSync(filepath);
  return true;
}
