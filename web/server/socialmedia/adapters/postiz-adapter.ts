// ─── Postiz Adapter ──────────────────────────────────────────────────────────
// REST client for Postiz Public API v1.
// Works with both hosted (api.postiz.com) and self-hosted instances.
// Auth: raw API key in Authorization header (no Bearer prefix).
// API key found at: Settings → Developers → Public API

import type { SocialMediaAdapter } from "../adapter.js";
import type { SocialProfile, CreatePostInput, PostAnalytics, AccountAnalytics, SocialComment, SocialPlatform } from "../types.js";

const HOSTED_API = "https://api.postiz.com";

// Postiz uses different identifiers than our standard platform names
const PLATFORM_TO_POSTIZ: Record<string, string> = {
  twitter: "x",
  instagram: "instagram",
  linkedin: "linkedin",
  facebook: "facebook",
  tiktok: "tiktok",
  threads: "threads",
};

const POSTIZ_TO_PLATFORM: Record<string, SocialPlatform> = {
  x: "twitter",
  instagram: "instagram",
  linkedin: "linkedin",
  facebook: "facebook",
  tiktok: "tiktok",
  threads: "threads",
};

export class PostizAdapter implements SocialMediaAdapter {
  private baseUrl: string;
  private apiKey: string;
  /** Cached integrations (channel list) */
  private integrations: Array<{ id: string; name: string; identifier: string; picture: string | null }> | null = null;

  private apiPrefix: string;

  constructor(config: { url?: string; apiKey: string }) {
    const raw = (config.url || HOSTED_API).replace(/\/+$/, "");
    // Ensure we point to the API base, not the frontend
    this.baseUrl = raw.includes("/public/v1") ? raw.replace(/\/public\/v1.*/, "") : raw;
    // Hosted (api.postiz.com) uses /public/v1, self-hosted uses /api/public/v1
    this.apiPrefix = raw === HOSTED_API || !config.url ? "/public/v1" : "/api/public/v1";
    this.apiKey = config.apiKey;
  }

  private url(path: string): string {
    return `${this.baseUrl}${this.apiPrefix}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": this.apiKey,
    };
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; error?: string; data?: unknown }> {
    try {
      const res = await fetch(this.url("/is-connected"), { headers: this.headers() });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `Postiz returned ${res.status}: ${text || res.statusText}` };
      }
      const data = await res.json();
      if (data.connected) {
        return { ok: true, data };
      }
      return { ok: false, error: "Not connected" };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "Connection failed" };
    }
  }

  // ─── Integrations / Profiles ────────────────────────────────────────────────

  private async loadIntegrations(): Promise<typeof this.integrations> {
    if (this.integrations) return this.integrations;
    try {
      const res = await fetch(this.url("/integrations"), { headers: this.headers() });
      if (!res.ok) return [];
      const data = await res.json();
      this.integrations = (Array.isArray(data) ? data : []).map((item: any) => ({
        id: item.id ?? "",
        name: item.name ?? item.profile ?? item.identifier ?? "",
        identifier: item.identifier ?? "",
        picture: item.picture ?? null,
      }));
      return this.integrations;
    } catch {
      return [];
    }
  }

  async getProfiles(): Promise<SocialProfile[]> {
    const integrations = await this.loadIntegrations();
    return (integrations || []).map((item) => ({
      id: item.id,
      platform: (POSTIZ_TO_PLATFORM[item.identifier] ?? item.identifier) as SocialPlatform,
      name: item.name,
      picture: item.picture,
    }));
  }

  supportedPlatforms(): SocialPlatform[] {
    return ["twitter", "instagram", "linkedin", "facebook", "tiktok", "threads"];
  }

  // ─── Posts ──────────────────────────────────────────────────────────────────

  async createPost(input: CreatePostInput): Promise<{ id: string | null; status: string; backendData?: unknown }> {
    try {
      const integrations = await this.loadIntegrations();

      // Resolve integration IDs for selected platforms
      const matchedIntegrations = (integrations || []).filter((ig) => {
        const platform = POSTIZ_TO_PLATFORM[ig.identifier];
        return platform && input.platforms.includes(platform);
      });

      if (matchedIntegrations.length === 0) {
        return { id: null, status: "failed", backendData: { error: "No connected integrations match the selected platforms" } };
      }

      // Upload media from URLs if present
      const mediaItems: Array<{ id: string; path: string }> = [];
      if (input.mediaUrls?.length) {
        for (const mediaUrl of input.mediaUrls) {
          try {
            const uploadRes = await fetch(this.url("/upload-from-url"), {
              method: "POST",
              headers: this.headers(),
              body: JSON.stringify({ url: mediaUrl }),
            });
            if (uploadRes.ok) {
              const uploadData = await uploadRes.json();
              if (uploadData.id && uploadData.path) {
                mediaItems.push({ id: uploadData.id, path: uploadData.path });
              }
            }
          } catch {
            // Skip failed uploads
          }
        }
      }

      // Build post payload per Postiz API
      const postEntries = matchedIntegrations.map((ig) => ({
        integration: { id: ig.id },
        value: [{
          content: input.text,
          image: mediaItems,
        }],
        settings: { __type: ig.identifier },
      }));

      const body: Record<string, unknown> = {
        type: input.scheduledAt ? "schedule" : "now",
        date: input.scheduledAt || new Date().toISOString(),
        shortLink: false,
        posts: postEntries,
      };

      const res = await fetch(this.url("/posts"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        return { id: null, status: "failed", backendData: data };
      }

      return {
        id: data.id ?? data.groupId ?? null,
        status: input.scheduledAt ? "scheduled" : "published",
        backendData: data,
      };
    } catch (err: any) {
      return { id: null, status: "failed", backendData: { error: err?.message } };
    }
  }

  async listPosts(opts?: { limit?: number }): Promise<Array<{ id: string; text: string; status: string; platforms: string[]; createdAt?: string | null; scheduledAt?: string | null }>> {
    try {
      // Postiz requires startDate/endDate
      const now = new Date();
      const endDate = new Date(now.getTime() + 30 * 86400000).toISOString(); // +30 days
      const startDate = new Date(now.getTime() - 90 * 86400000).toISOString(); // -90 days

      const res = await fetch(
        this.url(`/posts?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
        { headers: this.headers() },
      );
      if (!res.ok) return [];

      const data = await res.json();
      const posts = Array.isArray(data) ? data : data.posts ?? [];
      const limit = opts?.limit ?? 50;

      const STATE_MAP: Record<string, string> = {
        QUEUE: "scheduled",
        PUBLISHED: "published",
        ERROR: "failed",
        DRAFT: "draft",
      };

      return posts.slice(0, limit).map((p: any) => ({
        id: p.id ?? "",
        text: p.content ?? "",
        status: STATE_MAP[p.state] ?? p.state?.toLowerCase() ?? "unknown",
        platforms: p.integration?.identifier
          ? [POSTIZ_TO_PLATFORM[p.integration.identifier] ?? p.integration.identifier]
          : [],
        createdAt: p.createdAt ?? null,
        scheduledAt: p.publishDate ?? null,
      }));
    } catch {
      return [];
    }
  }

  async deletePost(postId: string): Promise<boolean> {
    try {
      const res = await fetch(this.url(`/posts/${postId}`), {
        method: "DELETE",
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── Analytics ──────────────────────────────────────────────────────────────

  async getAnalytics(postId: string): Promise<PostAnalytics> {
    try {
      const res = await fetch(this.url(`/analytics/post/${postId}?date=30`), { headers: this.headers() });
      if (!res.ok) return { impressions: 0, likes: 0, shares: 0, comments: 0 };
      const data = await res.json();
      if (data.missing) return { impressions: 0, likes: 0, shares: 0, comments: 0 };

      // Postiz returns array of { label, data: [{total, date}], percentageChange }
      const metrics = Array.isArray(data) ? data : [];
      const getValue = (label: string) => {
        const m = metrics.find((x: any) => x.label?.toLowerCase().includes(label));
        return m?.data?.reduce((sum: number, d: any) => sum + (parseInt(d.total) || 0), 0) ?? 0;
      };

      return {
        impressions: getValue("impression") || getValue("reach") || getValue("view"),
        likes: getValue("like") || getValue("favorite"),
        shares: getValue("share") || getValue("retweet") || getValue("repost"),
        comments: getValue("comment") || getValue("reply"),
      };
    } catch {
      return { impressions: 0, likes: 0, shares: 0, comments: 0 };
    }
  }

  async getAccountAnalytics(profileId: string): Promise<AccountAnalytics> {
    try {
      const res = await fetch(this.url(`/analytics/${profileId}?date=30`), { headers: this.headers() });
      if (!res.ok) return { followers: 0, following: 0, posts: 0 };
      const data = await res.json();

      const metrics = Array.isArray(data) ? data : [];
      const getLatest = (label: string) => {
        const m = metrics.find((x: any) => x.label?.toLowerCase().includes(label));
        const latest = m?.data?.[m.data.length - 1];
        return parseInt(latest?.total) || 0;
      };

      return {
        followers: getLatest("follower"),
        following: getLatest("following"),
        posts: getLatest("post") || getLatest("tweet"),
      };
    } catch {
      return { followers: 0, following: 0, posts: 0 };
    }
  }

  // ─── Comments (not supported by Postiz API) ────────────────────────────────

  async getComments(_postId: string): Promise<SocialComment[]> {
    return [];
  }

  async replyToComment(_postId: string, _commentId: string | null, _text: string): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: "Postiz does not support comment management via API" };
  }
}
