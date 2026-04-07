// ─── Ayrshare Adapter ────────────────────────────────────────────────────────
// REST client for Ayrshare social media API.

import type { SocialMediaAdapter } from "../adapter.js";
import type { SocialProfile, CreatePostInput, PostAnalytics, AccountAnalytics, SocialComment, SocialPlatform } from "../types.js";

const BASE_URL = "https://app.ayrshare.com/api";

export class AyrshareAdapter implements SocialMediaAdapter {
  private apiKey: string;

  constructor(config: { apiKey: string }) {
    this.apiKey = config.apiKey;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string; data?: unknown }> {
    try {
      const res = await fetch(`${BASE_URL}/user`, { headers: this.headers() });
      if (!res.ok) {
        return { ok: false, error: `Ayrshare returned ${res.status}: ${res.statusText}` };
      }
      const data = await res.json();
      return { ok: true, data };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "Connection failed" };
    }
  }

  async getProfiles(): Promise<SocialProfile[]> {
    try {
      const res = await fetch(`${BASE_URL}/user`, { headers: this.headers() });
      if (!res.ok) return [];
      const data = await res.json();
      const accounts: string[] = data.activeSocialAccounts ?? [];
      return accounts.map((platform) => ({
        id: platform,
        platform: platform as SocialPlatform,
        name: data.displayNames?.[platform] ?? platform,
        picture: null,
      }));
    } catch {
      return [];
    }
  }

  supportedPlatforms(): SocialPlatform[] {
    return ["twitter", "instagram", "linkedin", "facebook", "tiktok", "threads"];
  }

  async createPost(input: CreatePostInput): Promise<{ id: string | null; status: string; backendData?: unknown }> {
    try {
      const body: any = {
        post: input.text,
        platforms: input.platforms,
      };
      if (input.scheduledAt) {
        body.scheduleDate = input.scheduledAt;
      }
      if (input.mediaUrls?.length) {
        body.mediaUrls = input.mediaUrls;
      }

      const res = await fetch(`${BASE_URL}/post`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.status === "error") {
        return { id: null, status: "failed", backendData: data };
      }
      return {
        id: data.id ?? null,
        status: data.scheduleDate ? "scheduled" : "published",
        backendData: data,
      };
    } catch (err: any) {
      return { id: null, status: "failed", backendData: { error: err?.message } };
    }
  }

  async listPosts(opts?: { limit?: number }): Promise<Array<{ id: string; text: string; status: string; platforms: string[]; createdAt?: string | null; scheduledAt?: string | null }>> {
    try {
      const res = await fetch(`${BASE_URL}/history`, { headers: this.headers() });
      if (!res.ok) return [];
      const data = await res.json();
      const posts = Array.isArray(data) ? data : [];
      return posts.slice(0, opts?.limit ?? 50).map((p: any) => ({
        id: p.id ?? "",
        text: p.post ?? p.text ?? "",
        status: p.status ?? "unknown",
        platforms: p.platforms ?? [],
        createdAt: p.created ?? p.createdAt ?? null,
        scheduledAt: p.scheduleDate ?? null,
      }));
    } catch {
      return [];
    }
  }

  async deletePost(postId: string): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/post`, {
        method: "DELETE",
        headers: this.headers(),
        body: JSON.stringify({ id: postId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getAnalytics(postId: string): Promise<PostAnalytics> {
    try {
      const res = await fetch(`${BASE_URL}/analytics/post`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ id: postId }),
      });
      if (!res.ok) return { impressions: 0, likes: 0, shares: 0, comments: 0 };
      const data = await res.json();
      return {
        impressions: data.impressions ?? 0,
        likes: data.likes ?? data.engagements?.likes ?? 0,
        shares: data.shares ?? data.engagements?.shares ?? 0,
        comments: data.comments ?? data.engagements?.comments ?? 0,
      };
    } catch {
      return { impressions: 0, likes: 0, shares: 0, comments: 0 };
    }
  }

  async getAccountAnalytics(profileId: string): Promise<AccountAnalytics> {
    try {
      const res = await fetch(`${BASE_URL}/analytics/social`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ platforms: [profileId] }),
      });
      if (!res.ok) return { followers: 0, following: 0, posts: 0 };
      const data = await res.json();
      const analytics = data?.[profileId] ?? data;
      return {
        followers: analytics.followers ?? 0,
        following: analytics.following ?? 0,
        posts: analytics.posts ?? 0,
      };
    } catch {
      return { followers: 0, following: 0, posts: 0 };
    }
  }

  async getComments(_postId: string): Promise<SocialComment[]> {
    // Ayrshare comments not yet implemented
    return [];
  }

  async replyToComment(_postId: string, _commentId: string | null, _text: string): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: "Ayrshare comment replies not yet implemented" };
  }
}
