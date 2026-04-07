// ─── Social Media Store ──────────────────────────────────────────────────────
// File-based persistence for social media settings and posts.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SocialMediaSettings, SocialPost, ListPostsOpts } from "./types.js";
import { DEFAULT_SOCIAL_SETTINGS } from "./types.js";

const BASE_DIR = join(homedir(), ".heyhank", "socialmedia");
const SETTINGS_FILE = join(BASE_DIR, "settings.json");
const POSTS_DIR = join(BASE_DIR, "posts");

function ensureDirs(): void {
  if (!existsSync(BASE_DIR)) mkdirSync(BASE_DIR, { recursive: true });
  if (!existsSync(POSTS_DIR)) mkdirSync(POSTS_DIR, { recursive: true });
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function getSettings(): SocialMediaSettings {
  ensureDirs();
  if (!existsSync(SETTINGS_FILE)) return { ...DEFAULT_SOCIAL_SETTINGS };
  try {
    const raw = readFileSync(SETTINGS_FILE, "utf-8");
    return { ...DEFAULT_SOCIAL_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SOCIAL_SETTINGS };
  }
}

export function saveSettings(settings: SocialMediaSettings): void {
  ensureDirs();
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// ─── Posts ───────────────────────────────────────────────────────────────────

export function savePost(post: SocialPost): void {
  ensureDirs();
  if (!post.id) {
    post.id = randomUUID();
  }
  const file = join(POSTS_DIR, `${post.id}.json`);
  writeFileSync(file, JSON.stringify(post, null, 2), "utf-8");
}

export function getPost(postId: string): SocialPost | null {
  const file = join(POSTS_DIR, `${postId}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function listLocalPosts(opts?: ListPostsOpts): SocialPost[] {
  ensureDirs();
  const limit = opts?.limit ?? 50;
  try {
    const files = readdirSync(POSTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    let posts = files.map((f) => {
      try {
        return JSON.parse(readFileSync(join(POSTS_DIR, f), "utf-8")) as SocialPost;
      } catch {
        return null;
      }
    }).filter(Boolean) as SocialPost[];

    if (opts?.status) {
      posts = posts.filter((p) => p.status === opts.status);
    }
    if (opts?.platform) {
      posts = posts.filter((p) => p.platforms.includes(opts.platform as any));
    }

    return posts.slice(0, limit);
  } catch {
    return [];
  }
}

export function deleteLocalPost(postId: string): boolean {
  const file = join(POSTS_DIR, `${postId}.json`);
  if (!existsSync(file)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}
