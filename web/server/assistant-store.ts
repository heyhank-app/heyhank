// ─── Assistant Store ──────────────────────────────────────────────────────────
// Persistent storage for personal assistant features: todos, notes, reminders.
// All data stored as JSON in ~/.heyhank/assistant/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

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
  writeFileSync(join(ASSISTANT_DIR, filename), JSON.stringify(data, null, 2), "utf-8");
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
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function listTodos(filter?: { done?: boolean; priority?: string; category?: string }): Todo[] {
  const todos = readJson<Todo[]>("todos.json", []);
  return todos.filter((t) => {
    if (filter?.done !== undefined && t.done !== filter.done) return false;
    if (filter?.priority && t.priority !== filter.priority) return false;
    if (filter?.category && t.category !== filter.category) return false;
    return true;
  });
}

export function addTodo(text: string, priority: string = "medium", category?: string): Todo {
  const todos = readJson<Todo[]>("todos.json", []);
  const todo: Todo = {
    id: genId(),
    text,
    priority: (["high", "medium", "low"].includes(priority) ? priority : "medium") as Todo["priority"],
    done: false,
    createdAt: new Date().toISOString(),
    category,
  };
  todos.push(todo);
  writeJson("todos.json", todos);
  return todo;
}

export function completeTodo(id: string): Todo | null {
  const todos = readJson<Todo[]>("todos.json", []);
  const todo = todos.find((t) => t.id === id);
  if (!todo) return null;
  todo.done = true;
  todo.doneAt = new Date().toISOString();
  writeJson("todos.json", todos);
  return todo;
}

export function deleteTodo(id: string): boolean {
  const todos = readJson<Todo[]>("todos.json", []);
  const idx = todos.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  todos.splice(idx, 1);
  writeJson("todos.json", todos);
  return true;
}

export function updateTodo(id: string, patch: { text?: string; priority?: string; category?: string }): Todo | null {
  const todos = readJson<Todo[]>("todos.json", []);
  const todo = todos.find((t) => t.id === id);
  if (!todo) return null;
  if (patch.text) todo.text = patch.text;
  if (patch.priority && ["high", "medium", "low"].includes(patch.priority)) {
    todo.priority = patch.priority as Todo["priority"];
  }
  if (patch.category !== undefined) todo.category = patch.category;
  writeJson("todos.json", todos);
  return todo;
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
  const notes = readJson<Note[]>("notes.json", []);
  return notes.find((n) => n.id === id) || null;
}

export function updateNote(id: string, patch: { title?: string; content?: string; tags?: string[] }): Note | null {
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
}

export function listReminders(includeFired = false): Reminder[] {
  const reminders = readJson<Reminder[]>("reminders.json", []);
  return includeFired ? reminders : reminders.filter((r) => !r.fired);
}

export function addReminder(text: string, triggerAt: string): Reminder {
  const reminders = readJson<Reminder[]>("reminders.json", []);
  const reminder: Reminder = {
    id: genId(),
    text,
    triggerAt,
    fired: false,
    createdAt: new Date().toISOString(),
  };
  reminders.push(reminder);
  writeJson("reminders.json", reminders);
  return reminder;
}

export function fireReminder(id: string): Reminder | null {
  const reminders = readJson<Reminder[]>("reminders.json", []);
  const r = reminders.find((rem) => rem.id === id);
  if (!r) return null;
  r.fired = true;
  writeJson("reminders.json", reminders);
  return r;
}

export function deleteReminder(id: string): boolean {
  const reminders = readJson<Reminder[]>("reminders.json", []);
  const idx = reminders.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reminders.splice(idx, 1);
  writeJson("reminders.json", reminders);
  return true;
}

/** Get all reminders that should have fired by now */
export function getDueReminders(): Reminder[] {
  const now = new Date().toISOString();
  const reminders = readJson<Reminder[]>("reminders.json", []);
  return reminders.filter((r) => !r.fired && r.triggerAt <= now);
}
