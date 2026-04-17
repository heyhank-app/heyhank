// ─── Assistant Store ──────────────────────────────────────────────────────────
// Persistent storage for personal assistant features: todos, notes, reminders.
// All data stored as JSON in ~/.heyhank/assistant/
// When an Obsidian vault is configured, delegates to vault-store.ts instead.

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";
import { atomicWriteFileSync } from "./fs-utils.js";
import { getSettings } from "./settings-manager.js";
import * as vaultStore from "./vault-store.js";

function useVault(): boolean {
  return !!getSettings().obsidianVaultPath;
}

const ASSISTANT_DIR = join(HEYHANK_HOME, "assistant");

function ensureDir(): void {
  if (!existsSync(ASSISTANT_DIR)) {
    mkdirSync(ASSISTANT_DIR, { recursive: true });
  }
}

function readJson<T>(filename: string, fallback: T): T {
  ensureDir();
  const path = join(ASSISTANT_DIR, filename);
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as T;
    }
  } catch {}
  return fallback;
}

function writeJson(filename: string, data: unknown): void {
  ensureDir();
  atomicWriteFileSync(join(ASSISTANT_DIR, filename), JSON.stringify(data, null, 2));
}

// ─── Todos ────────────────────────────────────────────────────────────────────

export interface Todo {
  id: string;
  text: string;
  priority: "high" | "medium" | "low";
  done: boolean;
  createdAt: string;
  doneAt?: string;
  category?: string;
  delegatedTo?: string;
  dueDate?: string;
  followUpDate?: string;
  project?: string;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function listTodos(filter?: { done?: boolean; priority?: string; category?: string }): Todo[] {
  if (useVault()) return vaultStore.listTodos(filter);
  const todos = readJson<Todo[]>("todos.json", []);
  return todos.filter((t) => {
    if (filter?.done !== undefined && t.done !== filter.done) return false;
    if (filter?.priority && t.priority !== filter.priority) return false;
    if (filter?.category && t.category !== filter.category) return false;
    return true;
  });
}

export function addTodo(text: string, priority: string = "medium", category?: string, extra?: { delegatedTo?: string; dueDate?: string; followUpDate?: string; project?: string }): Todo {
  if (useVault()) return vaultStore.addTodo(text, priority, category, extra);
  const todos = readJson<Todo[]>("todos.json", []);
  const todo: Todo = {
    id: genId(),
    text,
    priority: (["high", "medium", "low"].includes(priority) ? priority : "medium") as Todo["priority"],
    done: false,
    createdAt: new Date().toISOString(),
    category,
    ...extra,
  };
  todos.push(todo);
  writeJson("todos.json", todos);
  return todo;
}

export function completeTodo(id: string): Todo | null {
  if (useVault()) return vaultStore.completeTodo(id);
  const todos = readJson<Todo[]>("todos.json", []);
  const todo = todos.find((t) => t.id === id);
  if (!todo) return null;
  todo.done = true;
  todo.doneAt = new Date().toISOString();
  writeJson("todos.json", todos);
  return todo;
}

export function deleteTodo(id: string): boolean {
  if (useVault()) return vaultStore.deleteTodo(id);
  const todos = readJson<Todo[]>("todos.json", []);
  const idx = todos.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  todos.splice(idx, 1);
  writeJson("todos.json", todos);
  return true;
}

export function updateTodo(id: string, patch: { text?: string; priority?: string; category?: string; delegatedTo?: string; dueDate?: string; followUpDate?: string; project?: string }): Todo | null {
  if (useVault()) return vaultStore.updateTodo(id, patch);
  const todos = readJson<Todo[]>("todos.json", []);
  const todo = todos.find((t) => t.id === id);
  if (!todo) return null;
  if (patch.text) todo.text = patch.text;
  if (patch.priority && ["high", "medium", "low"].includes(patch.priority)) {
    todo.priority = patch.priority as Todo["priority"];
  }
  if (patch.category !== undefined) todo.category = patch.category;
  if (patch.delegatedTo !== undefined) todo.delegatedTo = patch.delegatedTo;
  if (patch.dueDate !== undefined) todo.dueDate = patch.dueDate;
  if (patch.followUpDate !== undefined) todo.followUpDate = patch.followUpDate;
  if (patch.project !== undefined) todo.project = patch.project;
  writeJson("todos.json", todos);
  return todo;
}

export function listDelegations(person?: string): Todo[] {
  const todos = listTodos();
  const delegated = todos.filter((t) => t.delegatedTo && (!person || t.delegatedTo.toLowerCase() === person.toLowerCase()));
  return delegated.sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function listNotes(search?: string): Note[] {
  if (useVault()) return vaultStore.listNotes(search);
  const notes = readJson<Note[]>("notes.json", []);
  if (!search) return notes;
  const q = search.toLowerCase();
  return notes.filter((n) =>
    n.title.toLowerCase().includes(q) ||
    n.content.toLowerCase().includes(q) ||
    n.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export function addNote(title: string, content: string, tags: string[] = []): Note {
  if (useVault()) return vaultStore.addNote(title, content, tags);
  const notes = readJson<Note[]>("notes.json", []);
  const note: Note = {
    id: genId(),
    title,
    content,
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  notes.push(note);
  writeJson("notes.json", notes);
  return note;
}

export function getNote(id: string): Note | null {
  if (useVault()) return vaultStore.getNote(id);
  const notes = readJson<Note[]>("notes.json", []);
  return notes.find((n) => n.id === id) || null;
}

export function updateNote(id: string, patch: { title?: string; content?: string; tags?: string[] }): Note | null {
  if (useVault()) return vaultStore.updateNote(id, patch);
  const notes = readJson<Note[]>("notes.json", []);
  const note = notes.find((n) => n.id === id);
  if (!note) return null;
  if (patch.title) note.title = patch.title;
  if (patch.content) note.content = patch.content;
  if (patch.tags) note.tags = patch.tags;
  note.updatedAt = new Date().toISOString();
  writeJson("notes.json", notes);
  return note;
}

export function deleteNote(id: string): boolean {
  if (useVault()) return vaultStore.deleteNote(id);
  const notes = readJson<Note[]>("notes.json", []);
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return false;
  notes.splice(idx, 1);
  writeJson("notes.json", notes);
  return true;
}

// ─── Reminders ────────────────────────────────────────────────────────────────

export interface Reminder {
  id: string;
  text: string;
  triggerAt: string; // ISO datetime
  fired: boolean;
  createdAt: string;
  calendarEventUid?: string;
}

export function listReminders(includeFired = false): Reminder[] {
  if (useVault()) return vaultStore.listReminders(includeFired);
  const reminders = readJson<Reminder[]>("reminders.json", []);
  return includeFired ? reminders : reminders.filter((r) => !r.fired);
}

export function addReminder(text: string, triggerAt: string, calendarEventUid?: string): Reminder {
  if (useVault()) return vaultStore.addReminder(text, triggerAt, calendarEventUid);
  const reminders = readJson<Reminder[]>("reminders.json", []);
  const reminder: Reminder = {
    id: genId(),
    text,
    triggerAt,
    fired: false,
    createdAt: new Date().toISOString(),
    ...(calendarEventUid ? { calendarEventUid } : {}),
  };
  reminders.push(reminder);
  writeJson("reminders.json", reminders);
  return reminder;
}

export function updateReminder(id: string, updates: { text?: string; triggerAt?: string; calendarEventUid?: string }): Reminder | null {
  if (useVault()) return vaultStore.updateReminder(id, updates);
  const reminders = readJson<Reminder[]>("reminders.json", []);
  const r = reminders.find((rem) => rem.id === id);
  if (!r) return null;
  if (updates.text !== undefined) r.text = updates.text;
  if (updates.triggerAt !== undefined) r.triggerAt = updates.triggerAt;
  if (updates.calendarEventUid !== undefined) r.calendarEventUid = updates.calendarEventUid;
  writeJson("reminders.json", reminders);
  return r;
}

export function fireReminder(id: string): Reminder | null {
  if (useVault()) return vaultStore.fireReminder(id);
  const reminders = readJson<Reminder[]>("reminders.json", []);
  const r = reminders.find((rem) => rem.id === id);
  if (!r) return null;
  r.fired = true;
  writeJson("reminders.json", reminders);
  return r;
}

export function deleteReminder(id: string): boolean {
  if (useVault()) return vaultStore.deleteReminder(id);
  const reminders = readJson<Reminder[]>("reminders.json", []);
  const idx = reminders.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reminders.splice(idx, 1);
  writeJson("reminders.json", reminders);
  return true;
}

/** Get all reminders that should have fired by now */
export function getDueReminders(): Reminder[] {
  if (useVault()) return vaultStore.getDueReminders();
  const now = new Date().toISOString();
  const reminders = readJson<Reminder[]>("reminders.json", []);
  return reminders.filter((r) => !r.fired && r.triggerAt <= now);
}

// ─── Contacts/CRM ────────────────────────────────────────────────────────────

export interface ContactInteraction {
  date: string;
  type: "call" | "email" | "meeting" | "note";
  summary: string;
}

export interface Contact {
  id: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  notes?: string;
  tags: string[];
  lastContactDate?: string;
  interactions: ContactInteraction[];
  createdAt: string;
  updatedAt: string;
}

export function listContacts(search?: string): Contact[] {
  if (useVault()) return vaultStore.listContacts(search);
  const contacts = readJson<Contact[]>("contacts.json", []);
  if (!search) return contacts;
  const q = search.toLowerCase();
  return contacts.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    (c.company && c.company.toLowerCase().includes(q)) ||
    (c.email && c.email.toLowerCase().includes(q)) ||
    (c.phone && c.phone.includes(q)) ||
    c.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export function addContact(name: string, company?: string, email?: string, phone?: string, notes?: string, tags: string[] = []): Contact {
  if (useVault()) return vaultStore.addContact(name, company, email, phone, notes, tags);
  const contacts = readJson<Contact[]>("contacts.json", []);
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
  contacts.push(contact);
  writeJson("contacts.json", contacts);
  return contact;
}

export function getContact(id: string): Contact | null {
  if (useVault()) return vaultStore.getContact(id);
  const contacts = readJson<Contact[]>("contacts.json", []);
  return contacts.find((c) => c.id === id) || null;
}

export function updateContact(id: string, patch: { name?: string; company?: string; email?: string; phone?: string; notes?: string; tags?: string[] }): Contact | null {
  if (useVault()) return vaultStore.updateContact(id, patch);
  const contacts = readJson<Contact[]>("contacts.json", []);
  const contact = contacts.find((c) => c.id === id);
  if (!contact) return null;
  if (patch.name) contact.name = patch.name;
  if (patch.company !== undefined) contact.company = patch.company;
  if (patch.email !== undefined) contact.email = patch.email;
  if (patch.phone !== undefined) contact.phone = patch.phone;
  if (patch.notes !== undefined) contact.notes = patch.notes;
  if (patch.tags) contact.tags = patch.tags;
  contact.updatedAt = new Date().toISOString();
  writeJson("contacts.json", contacts);
  return contact;
}

export function deleteContact(id: string): boolean {
  if (useVault()) return vaultStore.deleteContact(id);
  const contacts = readJson<Contact[]>("contacts.json", []);
  const idx = contacts.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  contacts.splice(idx, 1);
  writeJson("contacts.json", contacts);
  return true;
}

export function logInteraction(contactId: string, interaction: Omit<ContactInteraction, "date">): Contact | null {
  if (useVault()) return vaultStore.logInteraction(contactId, interaction);
  const contacts = readJson<Contact[]>("contacts.json", []);
  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) return null;
  const entry: ContactInteraction = {
    date: new Date().toISOString(),
    type: interaction.type,
    summary: interaction.summary,
  };
  contact.interactions.push(entry);
  contact.lastContactDate = entry.date;
  contact.updatedAt = new Date().toISOString();
  writeJson("contacts.json", contacts);
  return contact;
}

// ─── Decisions ───────────────────────────────────────────────────────────────

export interface Decision {
  id: string;
  title: string;
  context: string;
  decision: string;
  alternatives: string[];
  reasoning: string;
  tags: string[];
  createdAt: string;
}

export function listDecisions(search?: string): Decision[] {
  if (useVault()) return vaultStore.listDecisions(search);
  const decisions = readJson<Decision[]>("decisions.json", []);
  if (!search) return decisions;
  const q = search.toLowerCase();
  return decisions.filter((d) =>
    d.title.toLowerCase().includes(q) ||
    d.context.toLowerCase().includes(q) ||
    d.decision.toLowerCase().includes(q) ||
    d.reasoning.toLowerCase().includes(q) ||
    d.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export function addDecision(title: string, context: string, decision: string, alternatives: string[] = [], reasoning: string = "", tags: string[] = []): Decision {
  if (useVault()) return vaultStore.addDecision(title, context, decision, alternatives, reasoning, tags);
  const decisions = readJson<Decision[]>("decisions.json", []);
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
  decisions.push(entry);
  writeJson("decisions.json", decisions);
  return entry;
}

export function getDecision(id: string): Decision | null {
  if (useVault()) return vaultStore.getDecision(id);
  const decisions = readJson<Decision[]>("decisions.json", []);
  return decisions.find((d) => d.id === id) || null;
}

export function deleteDecision(id: string): boolean {
  if (useVault()) return vaultStore.deleteDecision(id);
  const decisions = readJson<Decision[]>("decisions.json", []);
  const idx = decisions.findIndex((d) => d.id === id);
  if (idx === -1) return false;
  decisions.splice(idx, 1);
  writeJson("decisions.json", decisions);
  return true;
}

// ─── Gemini Conversations ────────────────────────────────────────────────────

export interface GeminiConversation {
  id: string;
  title: string;
  messages: Array<{ role: "user" | "gemini" | "system"; text: string; ts: number }>;
  createdAt: string;
  duration?: number; // seconds
}

export function listGeminiConversations(): GeminiConversation[] {
  if (useVault()) return vaultStore.listGeminiConversations();
  return readJson<GeminiConversation[]>("gemini-conversations.json", [])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function saveGeminiConversation(
  messages: Array<{ role: "user" | "gemini" | "system"; text: string; ts: number }>,
  duration?: number,
): GeminiConversation {
  if (useVault()) return vaultStore.saveGeminiConversation(messages, duration);
  const convos = readJson<GeminiConversation[]>("gemini-conversations.json", []);
  // Generate title from first user message
  const firstUser = messages.find((m) => m.role === "user");
  const title = firstUser ? firstUser.text.slice(0, 80) : "Gemini conversation";
  const convo: GeminiConversation = {
    id: genId(),
    title,
    messages: messages.filter((m) => m.role !== "system"),
    createdAt: new Date().toISOString(),
    duration,
  };
  convos.push(convo);
  // Keep last 100 conversations
  if (convos.length > 100) convos.splice(0, convos.length - 100);
  writeJson("gemini-conversations.json", convos);
  return convo;
}

export function getGeminiConversation(id: string): GeminiConversation | null {
  if (useVault()) return vaultStore.getGeminiConversation(id);
  const convos = readJson<GeminiConversation[]>("gemini-conversations.json", []);
  return convos.find((c) => c.id === id) || null;
}

export function deleteGeminiConversation(id: string): boolean {
  if (useVault()) return vaultStore.deleteGeminiConversation(id);
  const convos = readJson<GeminiConversation[]>("gemini-conversations.json", []);
  const idx = convos.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  convos.splice(idx, 1);
  writeJson("gemini-conversations.json", convos);
  return true;
}
