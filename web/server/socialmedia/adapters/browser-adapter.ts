// ─── Browser Adapter ─────────────────────────────────────────────────────────
// Posts to X (Twitter) and TikTok by driving the persistent Playwright context
// managed by SocialView (server/socialview/browser-manager.ts). User logs in
// once manually via noVNC; cookies persist in
// ~/.heyhank/browser-profiles/<platform>.
//
// Scope v1:
//   - X:      text + optional single image
//   - TikTok: video + description
// Analytics, comments, reply, list, delete are not supported here.

import type { SocialMediaAdapter } from "../adapter.js";
import type {
  SocialProfile,
  CreatePostInput,
  PostAnalytics,
  AccountAnalytics,
  SocialComment,
  SocialPlatform,
} from "../types.js";
import * as browser from "../../socialview/browser-manager.js";
import type { SocialPlatform as ViewPlatform } from "../../socialview/types.js";
import { postToTiktok, postToX, resolveMediaToDiskPath } from "../../socialview/poster.js";

// Subset of both the socialmedia and socialview SocialPlatform unions.
type BrowserBackedPlatform = Extract<SocialPlatform, "twitter" | "tiktok"> & ViewPlatform;
const SUPPORTED: BrowserBackedPlatform[] = ["twitter", "tiktok"];

export class BrowserAdapter implements SocialMediaAdapter {
  /**
   * Target platforms for a single `createPost` call. Set by the manager
   * before calling so we don't accidentally post to both X and TikTok when
   * only one was requested.
   */
  private targetPlatforms: BrowserBackedPlatform[] = [];

  setTargetPlatforms(platforms: SocialPlatform[]): void {
    this.targetPlatforms = platforms.filter(
      (p): p is BrowserBackedPlatform => (SUPPORTED as readonly SocialPlatform[]).includes(p),
    );
  }

  supportedPlatforms(): SocialPlatform[] {
    return [...SUPPORTED];
  }

  async testConnection(): Promise<{ ok: boolean; error?: string; data?: unknown }> {
    const results: Record<string, { running: boolean; loggedIn: boolean | null }> = {};
    const failures: string[] = [];
    for (const p of SUPPORTED) {
      const status = browser.getStatus(p);
      results[p] = { running: status.running, loggedIn: status.loggedIn };
      if (!status.running) failures.push(`${p}: browser not running`);
      else if (status.loggedIn === false) failures.push(`${p}: not logged in`);
    }
    if (failures.length > 0) {
      return { ok: false, error: failures.join("; "), data: results };
    }
    return { ok: true, data: results };
  }

  async getProfiles(): Promise<SocialProfile[]> {
    // v1: we don't read the actual handle from the DOM. Report a placeholder
    // per running+loggedIn platform so the UI at least shows a profile card.
    const out: SocialProfile[] = [];
    for (const p of SUPPORTED) {
      const status = browser.getStatus(p);
      if (status.running && status.loggedIn !== false) {
        out.push({
          id: `browser:${p}`,
          platform: p,
          name: `${p}-browser`,
          picture: null,
        });
      }
    }
    return out;
  }

  async createPost(
    input: CreatePostInput,
  ): Promise<{ id: string | null; status: string; backendData?: unknown }> {
    const platforms: BrowserBackedPlatform[] = this.targetPlatforms.length > 0
      ? this.targetPlatforms
      : input.platforms.filter(
          (p): p is BrowserBackedPlatform => (SUPPORTED as readonly SocialPlatform[]).includes(p),
        );

    if (platforms.length === 0) {
      return {
        id: null,
        status: "failed",
        backendData: { error: "BrowserAdapter called with no supported platforms" },
      };
    }

    const results: Record<string, { ok: boolean; url: string | null; error?: string }> = {};
    let anyOk = false;
    let anyFail = false;

    for (const platform of platforms) {
      try {
        // Ensure the persistent Chromium is running for this platform.
        const status = browser.getStatus(platform);
        if (!status.running) await browser.startPlatform(platform);

        const page = browser.getPage(platform);
        if (!page) throw new Error(`${platform}: browser page unavailable`);
        if (browser.getStatus(platform).loggedIn === false) {
          throw new Error(`${platform}: not logged in — open browser in SocialView and sign in`);
        }

        if (platform === "tiktok") {
          // TikTok requires a video. Prefer videoUrl, fall back to first mediaUrl.
          const videoUrl = input.videoUrl || (input.mediaUrls ?? [])[0];
          if (!videoUrl) throw new Error("tiktok: videoUrl (or mediaUrls[0]) required");
          const videoPath = await resolveMediaToDiskPath(videoUrl);
          const r = await postToTiktok(page, {
            description: input.text,
            videoPath,
          });
          results[platform] = { ok: true, url: r.url };
          anyOk = true;
        } else if (platform === "twitter") {
          // X: text + optional single image. v1 takes only mediaUrls[0].
          const firstMedia = (input.mediaUrls ?? [])[0];
          const imagePath = firstMedia ? await resolveMediaToDiskPath(firstMedia) : undefined;
          const r = await postToX(page, { text: input.text, imagePath });
          results[platform] = { ok: true, url: r.url };
          anyOk = true;
        } else {
          results[platform] = { ok: false, url: null, error: "unsupported" };
          anyFail = true;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results[platform] = { ok: false, url: null, error: message };
        anyFail = true;
      }
    }

    const status = anyOk && anyFail ? "partial" : anyOk ? "published" : "failed";
    // Pick a primary URL (first success) for the flat `id` slot; detailed
    // per-platform results go in backendData.
    const primary = platforms
      .map((p) => results[p])
      .find((r) => r?.ok && r.url)?.url ?? null;

    return {
      id: primary,
      status,
      backendData: { results },
    };
  }

  async listPosts(): Promise<Array<{ id: string; text: string; status: string; platforms: string[]; createdAt?: string | null; scheduledAt?: string | null }>> {
    return [];
  }

  async deletePost(_postId: string): Promise<boolean> {
    return false;
  }

  async getAnalytics(_postId: string): Promise<PostAnalytics> {
    return { impressions: 0, likes: 0, shares: 0, comments: 0 };
  }

  async getAccountAnalytics(_profileId: string): Promise<AccountAnalytics> {
    return { followers: 0, following: 0, posts: 0 };
  }

  async getComments(_postId: string): Promise<SocialComment[]> {
    return [];
  }

  async replyToComment(_postId: string, _commentId: string | null, _text: string): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: "not supported" };
  }
}
