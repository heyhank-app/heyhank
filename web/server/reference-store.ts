// ─── Reference Image Store ─────────────────────────────────────────────────
// Categorized reference images used by image-generation agents (e.g. as
// inputs to gpt-image-2 --edit). Stored on disk under
// ~/.heyhank/reference-images/<category>/<filename>.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, basename } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

const REFERENCES_DIR = join(HEYHANK_HOME, "reference-images");

/** Default categories created on first access. */
const DEFAULT_CATEGORIES = ["person", "logos", "products", "style"];

/** Allowed file extensions for reference images. */
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

const CATEGORY_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export interface ReferenceFile {
  filename: string;
  url: string;
  path: string;
  size: number;
  uploadedAt: number;
}

export interface ReferenceCategory {
  name: string;
  count: number;
  files: ReferenceFile[];
}

/** Validates a category name to prevent path traversal and weird characters. */
export function validateCategoryName(name: string): void {
  if (!CATEGORY_NAME_RE.test(name)) {
    throw new Error(
      "Invalid category name (allowed: letters, digits, _, -, max 64 chars)",
    );
  }
}

/** Returns the absolute path for a category, throwing if name is invalid. */
function categoryDir(name: string): string {
  validateCategoryName(name);
  return join(REFERENCES_DIR, name);
}

/** Ensures the base dir + default categories exist. */
function ensureDefaults(): void {
  mkdirSync(REFERENCES_DIR, { recursive: true });
  for (const cat of DEFAULT_CATEGORIES) {
    mkdirSync(join(REFERENCES_DIR, cat), { recursive: true });
  }
}

/** Lists all categories with their files. */
export function listReferences(): ReferenceCategory[] {
  ensureDefaults();
  const entries = readdirSync(REFERENCES_DIR, { withFileTypes: true });
  const categories: ReferenceCategory[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!CATEGORY_NAME_RE.test(entry.name)) continue;
    const dir = join(REFERENCES_DIR, entry.name);
    const files: ReferenceFile[] = [];
    for (const file of readdirSync(dir)) {
      const ext = file.split(".").pop()?.toLowerCase() || "";
      if (!ALLOWED_EXTENSIONS.has(ext)) continue;
      const fullPath = join(dir, file);
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;
      files.push({
        filename: file,
        url: `/api/references/file/${encodeURIComponent(entry.name)}/${encodeURIComponent(file)}`,
        path: fullPath,
        size: stat.size,
        uploadedAt: stat.mtimeMs,
      });
    }
    files.sort((a, b) => b.uploadedAt - a.uploadedAt);
    categories.push({ name: entry.name, count: files.length, files });
  }
  categories.sort((a, b) => a.name.localeCompare(b.name));
  return categories;
}

/** Creates a new (empty) category. Returns true if newly created, false if it existed. */
export function createCategory(name: string): boolean {
  const dir = categoryDir(name);
  if (existsSync(dir)) return false;
  mkdirSync(dir, { recursive: true });
  return true;
}

/** Deletes a category. Refuses if the category still contains files. */
export function deleteCategory(name: string): boolean {
  const dir = categoryDir(name);
  if (!existsSync(dir)) return false;
  const files = readdirSync(dir);
  if (files.length > 0) {
    throw new Error("Category is not empty");
  }
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Saves an uploaded reference image. Returns the saved file metadata. */
export function saveReference(
  category: string,
  originalFilename: string,
  data: Buffer,
): ReferenceFile {
  const dir = categoryDir(category);
  mkdirSync(dir, { recursive: true });

  const safeOriginal = basename(originalFilename);
  const ext = safeOriginal.split(".").pop()?.toLowerCase() || "png";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported extension: .${ext}`);
  }
  const filename = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const fullPath = join(dir, filename);
  writeFileSync(fullPath, data);
  const stat = statSync(fullPath);
  return {
    filename,
    url: `/api/references/file/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`,
    path: fullPath,
    size: stat.size,
    uploadedAt: stat.mtimeMs,
  };
}

/** Deletes a single reference file. */
export function deleteReference(category: string, filename: string): boolean {
  const dir = categoryDir(category);
  const safe = basename(filename);
  const fullPath = join(dir, safe);
  if (!existsSync(fullPath)) return false;
  rmSync(fullPath, { force: true });
  return true;
}

/** Returns the absolute file path for serving, or null if not found. */
export function getReferencePath(
  category: string,
  filename: string,
): string | null {
  try {
    const dir = categoryDir(category);
    const safe = basename(filename);
    const fullPath = join(dir, safe);
    if (!existsSync(fullPath)) return null;
    return fullPath;
  } catch {
    return null;
  }
}

/** Returns the root directory (exposed for testing/inspection). */
export function getReferencesDir(): string {
  return REFERENCES_DIR;
}
