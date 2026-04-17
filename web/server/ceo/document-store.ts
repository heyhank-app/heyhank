import { join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { randomUUID } from "crypto";
import { atomicWriteFileSync } from "../fs-utils.js";

export interface Document {
  id: string;
  title: string;
  fileType: string; // pdf, txt, md, docx, etc.
  size: number; // bytes
  path: string; // relative storage path
  tags: string[];
  folder: string;
  createdAt: string;
  updatedAt: string;
  summary?: string; // AI-generated summary
}

export interface DocumentMetadata {
  documents: Document[];
}

const DATA_DIR = join(process.env.HEYHANK_HOME || join(process.env.HOME || "/root", ".heyhank"), "documents");
const META_FILE = join(DATA_DIR, "_metadata.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadMeta(): DocumentMetadata {
  ensureDir();
  if (!existsSync(META_FILE)) return { documents: [] };
  try { return JSON.parse(readFileSync(META_FILE, "utf-8")); }
  catch { return { documents: [] }; }
}

function saveMeta(meta: DocumentMetadata) {
  ensureDir();
  atomicWriteFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

export function listDocuments(folder?: string, tag?: string): Document[] {
  const meta = loadMeta();
  let docs = meta.documents;
  if (folder) docs = docs.filter(d => d.folder === folder);
  if (tag) docs = docs.filter(d => d.tags.includes(tag));
  return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function addDocument(title: string, content: string, fileType: string, folder?: string, tags?: string[], summary?: string): Document {
  const meta = loadMeta();
  const id = randomUUID();
  const filename = `${id}.${fileType}`;
  const filePath = join(DATA_DIR, filename);

  writeFileSync(filePath, content);
  const stat = statSync(filePath);

  const doc: Document = {
    id,
    title,
    fileType,
    size: stat.size,
    path: filename,
    tags: tags || [],
    folder: folder || "General",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    summary
  };

  meta.documents.push(doc);
  saveMeta(meta);
  return doc;
}

export function getDocument(id: string): { meta: Document; content: string } | null {
  const meta = loadMeta();
  const doc = meta.documents.find(d => d.id === id);
  if (!doc) return null;
  const filePath = join(DATA_DIR, doc.path);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  return { meta: doc, content };
}

export function updateDocument(id: string, patch: Partial<Pick<Document, "title" | "tags" | "folder" | "summary">>): Document | null {
  const meta = loadMeta();
  const idx = meta.documents.findIndex(d => d.id === id);
  if (idx === -1) return null;

  if (patch.title !== undefined) meta.documents[idx].title = patch.title;
  if (patch.tags !== undefined) meta.documents[idx].tags = patch.tags;
  if (patch.folder !== undefined) meta.documents[idx].folder = patch.folder;
  if (patch.summary !== undefined) meta.documents[idx].summary = patch.summary;
  meta.documents[idx].updatedAt = new Date().toISOString();

  saveMeta(meta);
  return meta.documents[idx];
}

export function deleteDocument(id: string): boolean {
  const meta = loadMeta();
  const idx = meta.documents.findIndex(d => d.id === id);
  if (idx === -1) return false;

  const filePath = join(DATA_DIR, meta.documents[idx].path);
  if (existsSync(filePath)) unlinkSync(filePath);

  meta.documents.splice(idx, 1);
  saveMeta(meta);
  return true;
}

export function searchDocuments(query: string): Document[] {
  const meta = loadMeta();
  const q = query.toLowerCase();
  return meta.documents.filter(d =>
    d.title.toLowerCase().includes(q) ||
    d.tags.some(t => t.toLowerCase().includes(q)) ||
    d.folder.toLowerCase().includes(q) ||
    (d.summary && d.summary.toLowerCase().includes(q))
  );
}

export function listFolders(): string[] {
  const meta = loadMeta();
  return [...new Set(meta.documents.map(d => d.folder))].sort();
}
