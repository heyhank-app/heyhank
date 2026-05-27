// ─── Session Uploads ──────────────────────────────────────────────────────────
// Per-session file uploads (videos, PDFs, audio, archives, etc.) that are
// staged on disk so agents can reference them via absolute paths in their
// prompts. Images continue to flow inline via the WebSocket protocol as
// Claude image content blocks — only non-trivial / large / non-image files
// land here.
//
// Layout: ~/.heyhank/uploads/<sessionId>/<safe-name>
//
// Files are removed when the session is deleted (see session-orchestrator).

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

export const UPLOADS_DIR = join(HEYHANK_HOME, "uploads");

/** Hard cap per file. Videos can be large; 500 MB matches user-confirmed limit. */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/**
 * Executable / script extensions that we refuse to stage on disk. The agent
 * runs with `bypassPermissions`, so allowing arbitrary executables to be
 * dropped into its working tree would be a meaningful escalation vector
 * even for a single-user install.
 */
const BLOCKED_EXTS = new Set([
  "exe", "bat", "cmd", "com", "msi", "scr",
  "ps1", "psm1", "vbs", "wsf",
  "sh", "bash", "zsh", "fish",
  "dll", "so", "dylib",
  "apk", "ipa", "deb", "rpm",
]);

export interface UploadedFileInfo {
  /** Original sanitized filename (basename only, no path traversal). */
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** Size in bytes. */
  size: number;
  /** MIME type reported by the client; may be empty. */
  mimeType: string;
}

/** Validate a session identifier so it cannot escape the uploads directory. */
function isSafeSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(sessionId) && sessionId.length > 0 && sessionId.length < 256;
}

/** Strip path separators and other shell-hostile characters from a filename. */
export function sanitizeFilename(raw: string): string {
  const base = basename(raw).trim();
  // Replace anything outside [A-Za-z0-9._-] with "_" to keep paths shell-safe.
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  // Guard against empty / dotfile-only names.
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return `upload_${Date.now()}.bin`;
  }
  return cleaned.slice(0, 200);
}

/** Returns the per-session upload directory, creating it on first use. */
export function getSessionUploadDir(sessionId: string): string {
  if (!isSafeSessionId(sessionId)) {
    throw new Error("Invalid session id");
  }
  const dir = join(UPLOADS_DIR, sessionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve a final on-disk filename, adding a numeric suffix on collision. */
function resolveCollision(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem}_${i}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  // Final fallback: timestamped name.
  return `${stem}_${Date.now()}${ext}`;
}

/**
 * Persist an uploaded file. Caller must have already validated the session
 * exists; we only enforce filesystem-level safety here.
 */
export async function saveUploadedFile(
  sessionId: string,
  file: File,
): Promise<UploadedFileInfo> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds ${MAX_UPLOAD_BYTES} bytes`);
  }
  const safeName = sanitizeFilename(file.name || "upload.bin");
  const ext = extname(safeName).slice(1).toLowerCase();
  if (BLOCKED_EXTS.has(ext)) {
    throw new Error(`Files with .${ext} are not allowed`);
  }
  const dir = getSessionUploadDir(sessionId);
  const finalName = resolveCollision(dir, safeName);
  const fullPath = join(dir, finalName);
  const bytes = Buffer.from(await file.arrayBuffer());
  writeFileSync(fullPath, bytes);
  return {
    name: finalName,
    path: fullPath,
    size: bytes.length,
    mimeType: file.type || "",
  };
}

/** Remove a session's entire uploads directory. Idempotent. */
export function removeSessionUploads(sessionId: string): void {
  if (!isSafeSessionId(sessionId)) return;
  const dir = join(UPLOADS_DIR, sessionId);
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}
