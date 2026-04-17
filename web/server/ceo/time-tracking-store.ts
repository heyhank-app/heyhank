import { join } from "path";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { atomicWriteFileSync } from "../fs-utils.js";

export interface TimeEntry {
  id: string;
  task: string;
  project?: string;
  category?: string;
  startTime: string;
  endTime?: string;
  duration?: number; // minutes
  notes?: string;
  source: "manual" | "timer" | "auto"; // auto = derived from calls/emails/etc
  createdAt: string;
}

export interface ActiveTimer {
  id: string;
  task: string;
  project?: string;
  category?: string;
  startTime: string;
}

export interface TimeReport {
  period: string;
  startDate: string;
  endDate: string;
  totalMinutes: number;
  byProject: Record<string, number>;
  byCategory: Record<string, number>;
  byDay: Record<string, number>;
  entries: TimeEntry[];
}

const DATA_DIR = join(process.env.HEYHANK_HOME || join(process.env.HOME || "/root", ".heyhank"), "time-tracking");
const ENTRIES_FILE = join(DATA_DIR, "entries.json");
const TIMER_FILE = join(DATA_DIR, "active-timer.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadEntries(): TimeEntry[] {
  ensureDir();
  if (!existsSync(ENTRIES_FILE)) return [];
  try { return JSON.parse(readFileSync(ENTRIES_FILE, "utf-8")); }
  catch { return []; }
}

function saveEntries(entries: TimeEntry[]) {
  ensureDir();
  atomicWriteFileSync(ENTRIES_FILE, JSON.stringify(entries, null, 2));
}

function loadTimer(): ActiveTimer | null {
  ensureDir();
  if (!existsSync(TIMER_FILE)) return null;
  try { return JSON.parse(readFileSync(TIMER_FILE, "utf-8")); }
  catch { return null; }
}

function saveTimer(timer: ActiveTimer | null) {
  ensureDir();
  if (timer) {
    atomicWriteFileSync(TIMER_FILE, JSON.stringify(timer, null, 2));
  } else if (existsSync(TIMER_FILE)) {
    atomicWriteFileSync(TIMER_FILE, "null");
  }
}

// Timer
export function startTimer(task: string, project?: string, category?: string): ActiveTimer {
  // Stop existing timer first
  const existing = loadTimer();
  if (existing) stopTimer();

  const timer: ActiveTimer = {
    id: randomUUID(),
    task,
    project,
    category,
    startTime: new Date().toISOString()
  };
  saveTimer(timer);
  return timer;
}

export function getActiveTimer(): ActiveTimer | null {
  return loadTimer();
}

export function stopTimer(notes?: string): TimeEntry | null {
  const timer = loadTimer();
  if (!timer) return null;

  const endTime = new Date().toISOString();
  const duration = Math.round((new Date(endTime).getTime() - new Date(timer.startTime).getTime()) / 60000);

  const entry: TimeEntry = {
    id: timer.id,
    task: timer.task,
    project: timer.project,
    category: timer.category,
    startTime: timer.startTime,
    endTime,
    duration,
    notes,
    source: "timer",
    createdAt: new Date().toISOString()
  };

  const entries = loadEntries();
  entries.unshift(entry);
  saveEntries(entries);
  saveTimer(null);
  return entry;
}

// Manual entries
export function logTime(task: string, duration: number, project?: string, category?: string, notes?: string, date?: string): TimeEntry {
  const entries = loadEntries();
  const startTime = date || new Date().toISOString();
  const entry: TimeEntry = {
    id: randomUUID(),
    task,
    project,
    category,
    startTime,
    duration,
    notes,
    source: "manual",
    createdAt: new Date().toISOString()
  };
  entries.unshift(entry);
  saveEntries(entries);
  return entry;
}

export function listEntries(startDate?: string, endDate?: string, project?: string): TimeEntry[] {
  let entries = loadEntries();
  if (startDate) entries = entries.filter(e => e.startTime >= startDate);
  if (endDate) entries = entries.filter(e => e.startTime <= endDate);
  if (project) entries = entries.filter(e => e.project === project);
  return entries;
}

export function deleteEntry(id: string): boolean {
  const entries = loadEntries();
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  saveEntries(entries);
  return true;
}

export function updateEntry(id: string, patch: Partial<Pick<TimeEntry, "task" | "project" | "category" | "duration" | "notes">>): TimeEntry | null {
  const entries = loadEntries();
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return null;
  Object.assign(entries[idx], patch);
  saveEntries(entries);
  return entries[idx];
}

// Reports
export function getReport(period: "today" | "week" | "month" | "custom", startDate?: string, endDate?: string): TimeReport {
  const now = new Date();
  let start: Date;
  let end: Date = now;

  switch (period) {
    case "today":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "week":
      start = new Date(now);
      start.setDate(start.getDate() - start.getDay() + 1); // Monday
      start.setHours(0, 0, 0, 0);
      break;
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "custom":
      start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
      end = endDate ? new Date(endDate) : now;
      break;
  }

  const entries = listEntries(start.toISOString(), end.toISOString());

  const byProject: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  let totalMinutes = 0;

  for (const entry of entries) {
    const mins = entry.duration || 0;
    totalMinutes += mins;

    const proj = entry.project || "Uncategorized";
    byProject[proj] = (byProject[proj] || 0) + mins;

    const cat = entry.category || "General";
    byCategory[cat] = (byCategory[cat] || 0) + mins;

    const day = entry.startTime.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + mins;
  }

  return {
    period,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    totalMinutes,
    byProject,
    byCategory,
    byDay,
    entries
  };
}

export function listProjects(): string[] {
  return [...new Set(loadEntries().map(e => e.project).filter(Boolean) as string[])].sort();
}
