import { join } from "path";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { atomicWriteFileSync } from "../fs-utils.js";

export interface NewsSource {
  id: string;
  name: string;
  type: "rss" | "website" | "keyword";
  url?: string; // for rss/website
  keywords?: string[]; // for keyword monitoring
  category: string;
  enabled: boolean;
  checkInterval: number; // minutes
  lastChecked?: string;
  createdAt: string;
}

export interface NewsItem {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  summary: string;
  url?: string;
  category: string;
  publishedAt: string;
  fetchedAt: string;
  read: boolean;
  saved: boolean;
  relevance?: number; // 0-100, AI-scored
}

const DATA_DIR = join(process.env.HEYHANK_HOME || join(process.env.HOME || "/root", ".heyhank"), "news");
const SOURCES_FILE = join(DATA_DIR, "sources.json");
const ITEMS_FILE = join(DATA_DIR, "items.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadSources(): NewsSource[] {
  ensureDir();
  if (!existsSync(SOURCES_FILE)) return [];
  try { return JSON.parse(readFileSync(SOURCES_FILE, "utf-8")); }
  catch { return []; }
}

function saveSources(sources: NewsSource[]) {
  ensureDir();
  atomicWriteFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2));
}

function loadItems(): NewsItem[] {
  ensureDir();
  if (!existsSync(ITEMS_FILE)) return [];
  try { return JSON.parse(readFileSync(ITEMS_FILE, "utf-8")); }
  catch { return []; }
}

function saveItems(items: NewsItem[]) {
  ensureDir();
  // Keep max 500 items
  const trimmed = items.slice(0, 500);
  atomicWriteFileSync(ITEMS_FILE, JSON.stringify(trimmed, null, 2));
}

// Sources
export function addSource(name: string, type: NewsSource["type"], category: string, url?: string, keywords?: string[], checkInterval?: number): NewsSource {
  const sources = loadSources();
  const source: NewsSource = {
    id: randomUUID(),
    name,
    type,
    url,
    keywords,
    category,
    enabled: true,
    checkInterval: checkInterval || 60,
    createdAt: new Date().toISOString()
  };
  sources.push(source);
  saveSources(sources);
  return source;
}

export function listSources(): NewsSource[] {
  return loadSources();
}

export function updateSource(id: string, patch: Partial<Pick<NewsSource, "name" | "enabled" | "checkInterval" | "keywords" | "url" | "category">>): NewsSource | null {
  const sources = loadSources();
  const idx = sources.findIndex(s => s.id === id);
  if (idx === -1) return null;
  Object.assign(sources[idx], patch);
  saveSources(sources);
  return sources[idx];
}

export function deleteSource(id: string): boolean {
  const sources = loadSources();
  const idx = sources.findIndex(s => s.id === id);
  if (idx === -1) return false;
  sources.splice(idx, 1);
  saveSources(sources);
  // Also remove items from this source
  const items = loadItems().filter(i => i.sourceId !== id);
  saveItems(items);
  return true;
}

export function markSourceChecked(id: string): void {
  const sources = loadSources();
  const idx = sources.findIndex(s => s.id === id);
  if (idx !== -1) {
    sources[idx].lastChecked = new Date().toISOString();
    saveSources(sources);
  }
}

// Items
export function addNewsItem(sourceId: string, sourceName: string, title: string, summary: string, category: string, url?: string, relevance?: number): NewsItem {
  const items = loadItems();
  // Dedup by title+source
  if (items.some(i => i.sourceId === sourceId && i.title === title)) {
    return items.find(i => i.sourceId === sourceId && i.title === title)!;
  }
  const item: NewsItem = {
    id: randomUUID(),
    sourceId,
    sourceName,
    title,
    summary,
    url,
    category,
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    read: false,
    saved: false,
    relevance
  };
  items.unshift(item);
  saveItems(items);
  return item;
}

export function listNews(category?: string, unreadOnly?: boolean, savedOnly?: boolean, limit?: number): NewsItem[] {
  let items = loadItems();
  if (category) items = items.filter(i => i.category === category);
  if (unreadOnly) items = items.filter(i => !i.read);
  if (savedOnly) items = items.filter(i => i.saved);
  return items.slice(0, limit || 50);
}

export function markRead(id: string): boolean {
  const items = loadItems();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return false;
  items[idx].read = true;
  saveItems(items);
  return true;
}

export function markAllRead(category?: string): number {
  const items = loadItems();
  let count = 0;
  for (const item of items) {
    if (!item.read && (!category || item.category === category)) {
      item.read = true;
      count++;
    }
  }
  saveItems(items);
  return count;
}

export function toggleSaved(id: string): NewsItem | null {
  const items = loadItems();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return null;
  items[idx].saved = !items[idx].saved;
  saveItems(items);
  return items[idx];
}

export function searchNews(query: string): NewsItem[] {
  const q = query.toLowerCase();
  return loadItems().filter(i =>
    i.title.toLowerCase().includes(q) ||
    i.summary.toLowerCase().includes(q) ||
    i.sourceName.toLowerCase().includes(q)
  );
}

export function getNewsStats(): { total: number; unread: number; sources: number; byCategory: Record<string, number> } {
  const items = loadItems();
  const sources = loadSources();
  const byCategory: Record<string, number> = {};
  for (const item of items.filter(i => !i.read)) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  }
  return {
    total: items.length,
    unread: items.filter(i => !i.read).length,
    sources: sources.filter(s => s.enabled).length,
    byCategory
  };
}
