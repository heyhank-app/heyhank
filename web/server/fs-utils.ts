import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";

/** Count newlines in a file. Fast: reads raw buffer, counts 0x0A bytes. */
export function countFileLines(path: string): number {
  try {
    const buf = readFileSync(path);
    let count = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Atomic write: write to `path.tmp` then rename over the destination.
 *
 * Prevents corrupted/half-written files if the process crashes or two writers
 * race each other — rename is atomic on POSIX & NTFS within the same filesystem.
 * If the rename fails, the tmp file is removed so no `.tmp` junk is left behind.
 */
export function atomicWriteFileSync(
  path: string,
  content: string | Buffer | Uint8Array,
  encoding: BufferEncoding = "utf-8",
): void {
  const tmp = `${path}.tmp`;
  try {
    if (typeof content === "string") {
      writeFileSync(tmp, content, encoding);
    } else {
      writeFileSync(tmp, content);
    }
    renameSync(tmp, path);
  } catch (err) {
    // Best-effort cleanup of the temp file so we don't leave turds behind
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}
