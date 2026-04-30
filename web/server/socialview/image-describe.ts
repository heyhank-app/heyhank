// ─── Image Description (via Claude Code Subscription) ───────────────────────
// Downloads remote post images to ~/.heyhank/socialview/media/<postId>.<ext>
// and feeds them to Claude Code's Read tool to produce a textual description.
// Used to backfill `media[].description` for posts whose visual signal would
// otherwise be missing from the persona analysis.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { HEYHANK_HOME } from "../paths.js";
import { savePost } from "./library.js";
import type { LibraryPost } from "./types.js";

const MEDIA_ROOT = join(HEYHANK_HOME, "socialview", "media");

const DESCRIBE_PROMPT = `Beschreibe dieses Social-Media-Post-Bild für einen Content-Agent (3-5 prägnante Bullets, unter 120 Wörter total):
- Motiv & Komposition (was ist im Bild, wie ist es arrangiert)
- Farbpalette & Stimmung (warm/kühl, gesättigt/gedämpft, dominante Farben)
- Text-Overlays falls vorhanden (wörtlich zitieren)
- Stil (flatlay, portrait, candid, stock-ish, UGC, studio, meme, infographic)
- Produktionsqualität-Signale (natürliches Licht, Tiefenschärfe, Markenkonsistenz)

Nur die Bullets, kein Vorwort.`;

/** Download a remote image to local disk. Returns the local path or null on failure. */
async function downloadImage(url: string, postId: string, idx: number): Promise<string | null> {
  try {
    mkdirSync(MEDIA_ROOT, { recursive: true });
    const safeId = postId.replace(/[^a-z0-9._-]/gi, "_");
    const ext = guessExtension(url);
    const localPath = join(MEDIA_ROOT, `${safeId}-${idx}.${ext}`);

    if (existsSync(localPath) && statSync(localPath).size > 0) {
      return localPath;
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    writeFileSync(localPath, buf);
    return localPath;
  } catch {
    return null;
  }
}

function guessExtension(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".png")) return "png";
    if (path.endsWith(".webp")) return "webp";
    if (path.endsWith(".gif")) return "gif";
    return "jpg";
  } catch {
    return "jpg";
  }
}

/** Spawn `claude -p` with Read enabled, point it at the image, capture stdout. */
function describeImageViaClaudeCode(imagePath: string, timeoutMs = 90_000): Promise<string> {
  return new Promise((resolve) => {
    const childEnv: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" };
    delete childEnv.CLAUDECODE;
    delete childEnv.CLAUDE_CODE_ENTRYPOINT;

    // Pre-approve Read via the settings glob pattern (Read(*)). The plain
    // `--tools "Read"` enables Read but still demands interactive permission,
    // which blocks under root (where --dangerously-skip-permissions is denied).
    const args = [
      "-p",
      "--allowedTools", "Read(*)",
      "--add-dir", dirname(imagePath),
      "--no-session-persistence",
      "--model", "sonnet",
      `${DESCRIBE_PROMPT}\n\nLies das Bild unter: ${imagePath}`,
    ];

    let child;
    try {
      child = spawn("claude", args, {
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve("");
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve("");
    }, timeoutMs);

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve("");
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[image-describe] claude exit ${code}:`, stderr.slice(-200));
        resolve("");
      }
    });
  });
}

/**
 * For each post with image media that has empty description, download the image
 * (if not already cached) and describe it via Claude Code. Mutates the posts
 * in-place AND persists the updated post to library disk so future persona
 * analyses won’t re-do the work.
 *
 * Optimizations vs. naive serial loop:
 *  - Only describes the FIRST image per post (the dominant visual). For style
 *    analysis a single visual sample per post is sufficient and 25 posts × N
 *    images would explode runtime under nginx’s proxy timeout.
 *  - Runs up to CONCURRENCY describe-jobs in parallel.
 *
 * Returns the same array (with updated description fields) for chaining.
 */
export async function backfillImageDescriptions(
  posts: LibraryPost[],
): Promise<LibraryPost[]> {
  const CONCURRENCY = 4;

  type Job = { post: LibraryPost; idx: number };
  const jobs: Job[] = [];
  for (const post of posts) {
    // First image only — style analysis needs one visual signal per post,
    // not all carousel slides.
    const idx = post.media.findIndex(
      (m) => m.type === "image" && !(m.description && m.description.trim()) && !!m.remoteUrl,
    );
    if (idx === -1) continue;
    jobs.push({ post, idx });
  }

  if (jobs.length === 0) return posts;

  let cursor = 0;
  const dirtyPosts = new Set<LibraryPost>();

  async function worker() {
    while (true) {
      const myIdx = cursor++;
      if (myIdx >= jobs.length) return;
      const { post, idx } = jobs[myIdx]!;
      const m = post.media[idx]!;

      let localPath: string | null = m.localPath ?? null;
      if (!localPath || !existsSync(localPath)) {
        localPath = await downloadImage(m.remoteUrl!, post.id, idx);
      }
      if (!localPath) continue;

      const desc = await describeImageViaClaudeCode(localPath);
      if (!desc) continue;

      m.localPath = localPath;
      m.description = desc;
      dirtyPosts.add(post);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  for (const post of dirtyPosts) savePost(post);
  return posts;
}
