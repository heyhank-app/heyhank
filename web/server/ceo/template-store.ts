import { join } from "path";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { atomicWriteFileSync } from "../fs-utils.js";

export interface TemplateVariable {
  name: string;
  description?: string;
  defaultValue?: string;
  required?: boolean;
}

export interface Template {
  id: string;
  name: string;
  category: string; // email, contract, meeting, invoice, report, custom
  content: string;  // with {{variable}} placeholders
  variables: TemplateVariable[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  lastUsed?: string;
}

const DATA_DIR = join(process.env.HEYHANK_HOME || join(process.env.HOME || "/root", ".heyhank"), "templates");
const STORE_FILE = join(DATA_DIR, "templates.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function load(): Template[] {
  ensureDir();
  if (!existsSync(STORE_FILE)) return [];
  try { return JSON.parse(readFileSync(STORE_FILE, "utf-8")); }
  catch { return []; }
}

function save(templates: Template[]) {
  ensureDir();
  atomicWriteFileSync(STORE_FILE, JSON.stringify(templates, null, 2));
}

export function listTemplates(category?: string): Template[] {
  let templates = load();
  if (category) templates = templates.filter(t => t.category === category);
  return templates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createTemplate(name: string, content: string, category: string, variables?: TemplateVariable[], tags?: string[]): Template {
  const templates = load();

  // Auto-detect variables from {{...}} placeholders if not provided
  const detectedVars = [...content.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  const vars: TemplateVariable[] = variables || detectedVars.map(v => ({ name: v, required: true }));

  const template: Template = {
    id: randomUUID(),
    name,
    category,
    content,
    variables: vars,
    tags: tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0
  };

  templates.push(template);
  save(templates);
  return template;
}

export function getTemplate(id: string): Template | null {
  return load().find(t => t.id === id) || null;
}

export function updateTemplate(id: string, patch: Partial<Pick<Template, "name" | "content" | "category" | "variables" | "tags">>): Template | null {
  const templates = load();
  const idx = templates.findIndex(t => t.id === id);
  if (idx === -1) return null;

  if (patch.name !== undefined) templates[idx].name = patch.name;
  if (patch.content !== undefined) templates[idx].content = patch.content;
  if (patch.category !== undefined) templates[idx].category = patch.category;
  if (patch.variables !== undefined) templates[idx].variables = patch.variables;
  if (patch.tags !== undefined) templates[idx].tags = patch.tags;
  templates[idx].updatedAt = new Date().toISOString();

  save(templates);
  return templates[idx];
}

export function deleteTemplate(id: string): boolean {
  const templates = load();
  const idx = templates.findIndex(t => t.id === id);
  if (idx === -1) return false;
  templates.splice(idx, 1);
  save(templates);
  return true;
}

export function useTemplate(id: string, variables: Record<string, string>): { result: string; template: Template } | null {
  const templates = load();
  const idx = templates.findIndex(t => t.id === id);
  if (idx === -1) return null;

  let result = templates[idx].content;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  // Update usage stats
  templates[idx].usageCount++;
  templates[idx].lastUsed = new Date().toISOString();
  save(templates);

  return { result, template: templates[idx] };
}

export function searchTemplates(query: string): Template[] {
  const q = query.toLowerCase();
  return load().filter(t =>
    t.name.toLowerCase().includes(q) ||
    t.category.toLowerCase().includes(q) ||
    t.tags.some(tag => tag.toLowerCase().includes(q)) ||
    t.content.toLowerCase().includes(q)
  );
}

export function listCategories(): string[] {
  return [...new Set(load().map(t => t.category))].sort();
}
