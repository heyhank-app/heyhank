// ─── Buffer Adapter ──────────────────────────────────────────────────────────
// GraphQL client for Buffer's new API (https://developers.buffer.com).
// Auth: Bearer token via Authorization header.
// Endpoint: POST https://api.buffer.com (GraphQL).

import type { SocialMediaAdapter } from "../adapter.js";
import type { SocialProfile, CreatePostInput, PostAnalytics, AccountAnalytics, SocialComment, SocialPlatform } from "../types.js";
import { getSettings as getAppSettings } from "../../settings-manager.js";
import { signMediaUrl } from "../../routes/media-routes.js";

const API_URL = "https://api.buffer.com";

// Signed URLs valid for 7 days — covers immediate publishes plus Buffer's
// scheduled-post window. The signature uses the HMAC of (filename, expiresAt)
// with the HeyHank auth token as the secret.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Buffer fetches asset URLs server-side and must reach them without our auth
 * header. For local HeyHank media files (`/api/media/file/<filename>`) we
 * generate a signed URL (`/api/media/signed/<expires>/<sig>/<filename>`) that
 * bypasses the auth middleware. Already-absolute URLs are passed through.
 */
function toAbsoluteMediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;

  const publicUrl = getAppSettings().publicUrl?.replace(/\/+$/, "") ?? "";
  if (!publicUrl) {
    throw new Error(`Cannot resolve "${url}" to absolute URL: publicUrl is not set in HeyHank settings`);
  }

  // Match `/api/media/file/<filename>` (with or without the `/api` prefix —
  // both forms appear in the codebase depending on whether the URL was built
  // before or after the API path mount).
  const localMatch = url.match(/^\/?(?:api\/)?media\/file\/([^/?#]+)$/);
  if (localMatch) {
    const filename = localMatch[1];
    const { signature, expiresAt } = signMediaUrl(filename, SIGNED_URL_TTL_SECONDS);
    return `${publicUrl}/api/media/signed/${expiresAt}/${signature}/${encodeURIComponent(filename)}`;
  }

  return url.startsWith("/") ? `${publicUrl}${url}` : `${publicUrl}/${url}`;
}

const SERVICE_TO_PLATFORM: Record<string, SocialPlatform> = {
  twitter: "twitter",
  instagram: "instagram",
  linkedin: "linkedin",
  facebook: "facebook",
  tiktok: "tiktok",
  threads: "threads",
};

export class BufferAdapter implements SocialMediaAdapter {
  private token: string;
  private orgId: string | null = null;

  constructor(config: { apiKey: string }) {
    this.token = config.apiKey;
  }

  private async gql<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const body: Record<string, unknown> = { query };
    if (variables) body.variables = variables;

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    const json = await res.json() as any;

    if (json.errors?.length) {
      const msg = json.errors.map((e: any) => e.message).join("; ");
      throw new Error(msg);
    }

    return json.data as T;
  }

  /** Fetch and cache the first organization ID (needed for most queries). */
  private async getOrgId(): Promise<string> {
    if (this.orgId) return this.orgId;

    const data = await this.gql<{ account: { organizations: Array<{ id: string; name: string }> } }>(`
      query GetOrganizations {
        account {
          organizations {
            id
            name
          }
        }
      }
    `);

    const orgs = data.account?.organizations ?? [];
    if (orgs.length === 0) throw new Error("No organizations found in Buffer account");
    this.orgId = orgs[0].id;
    return this.orgId;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string; data?: unknown }> {
    try {
      const data = await this.gql(`
        query GetOrganizations {
          account {
            organizations {
              id
              name
              ownerEmail
            }
          }
        }
      `);
      return { ok: true, data };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "Connection failed" };
    }
  }

  async getProfiles(): Promise<SocialProfile[]> {
    try {
      const orgId = await this.getOrgId();
      const data = await this.gql<{ channels: Array<{ id: string; name: string; displayName: string; service: string; avatar: string | null }> }>(`
        query GetChannels($orgId: OrganizationId!) {
          channels(input: { organizationId: $orgId }) {
            id
            name
            displayName
            service
            avatar
          }
        }
      `, { orgId });

      return (data.channels ?? []).map((ch) => ({
        id: ch.id,
        platform: (SERVICE_TO_PLATFORM[ch.service] ?? ch.service) as SocialPlatform,
        name: ch.displayName || ch.name || ch.service,
        picture: ch.avatar ?? null,
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
      // Resolve channel IDs for selected platforms
      const profiles = await this.getProfiles();
      const channels = profiles.filter((p) => input.platforms.includes(p.platform));

      if (channels.length === 0) {
        return { id: null, status: "failed", backendData: { error: "No connected channels match the selected platforms" } };
      }

      // Create a post for each matching channel
      const results: Array<{ id: string | null; error?: string }> = [];

      for (const channel of channels) {
        const isScheduled = !!input.scheduledAt;
        const mode = isScheduled ? "customScheduled" : "addToQueue";

        // Build the input inline to support assets and dueAt conditionally
        let inputFields = `text: ${JSON.stringify(input.text)}, channelId: "${channel.id}", schedulingType: automatic, mode: ${mode}`;

        if (isScheduled) {
          inputFields += `, dueAt: "${input.scheduledAt}"`;
        }

        if (input.mediaUrls?.length) {
          // Buffer GraphQL schema: assets is [AssetInput!]! where each
          // AssetInput has exactly one of image/video/document/link. For now we
          // only handle image assets (TikTok Photo Mode + IG single-image).
          const assets = input.mediaUrls
            .filter((u) => u)
            .map((url) => `{ image: { url: ${JSON.stringify(toAbsoluteMediaUrl(url))} } }`)
            .join(", ");
          inputFields += `, assets: [${assets}]`;
        } else {
          // assets is non-null on the schema even when empty
          inputFields += `, assets: []`;
        }

        const query = `
          mutation CreatePost {
            createPost(input: { ${inputFields} }) {
              ... on PostActionSuccess {
                post {
                  id
                  text
                  dueAt
                }
              }
              ... on MutationError {
                message
              }
            }
          }
        `;

        const data = await this.gql<{ createPost: { post?: { id: string }; message?: string } }>(query);

        if (data.createPost?.post?.id) {
          results.push({ id: data.createPost.post.id });
        } else {
          results.push({ id: null, error: data.createPost?.message ?? "Unknown error" });
        }
      }

      const firstSuccess = results.find((r) => r.id);
      if (firstSuccess) {
        return {
          id: firstSuccess.id,
          status: input.scheduledAt ? "scheduled" : "published",
          backendData: results,
        };
      }

      return { id: null, status: "failed", backendData: results };
    } catch (err: any) {
      return { id: null, status: "failed", backendData: { error: err?.message } };
    }
  }

  async listPosts(opts?: { limit?: number }): Promise<Array<{ id: string; text: string; status: string; platforms: string[]; createdAt?: string | null; scheduledAt?: string | null }>> {
    try {
      const orgId = await this.getOrgId();
      const limit = opts?.limit ?? 50;

      // Fetch sent and scheduled posts
      const [sentData, scheduledData] = await Promise.all([
        this.gql<{ posts: { edges: Array<{ node: { id: string; text: string; createdAt: string; dueAt?: string; channelId: string; status: string } }> } }>(`
          query GetSentPosts($orgId: OrganizationId!, $first: Int) {
            posts(first: $first, input: {
              organizationId: $orgId,
              sort: [{ field: dueAt, direction: desc }],
              filter: { status: sent }
            }) {
              edges {
                node { id text createdAt dueAt channelId status }
              }
            }
          }
        `, { orgId, first: limit }),
        this.gql<{ posts: { edges: Array<{ node: { id: string; text: string; createdAt: string; dueAt?: string; channelId: string; status: string } }> } }>(`
          query GetScheduledPosts($orgId: OrganizationId!, $first: Int) {
            posts(first: $first, input: {
              organizationId: $orgId,
              sort: [{ field: dueAt, direction: asc }],
              filter: { status: scheduled }
            }) {
              edges {
                node { id text createdAt dueAt channelId status }
              }
            }
          }
        `, { orgId, first: limit }),
      ]);

      const profiles = await this.getProfiles();
      const channelToPlatform = new Map(profiles.map((p) => [p.id, p.platform]));

      const posts: Array<{ id: string; text: string; status: string; platforms: string[]; createdAt?: string | null; scheduledAt?: string | null }> = [];

      for (const edge of sentData.posts?.edges ?? []) {
        const n = edge.node;
        posts.push({
          id: n.id,
          text: n.text ?? "",
          status: "published",
          platforms: [channelToPlatform.get(n.channelId) ?? "unknown"],
          createdAt: n.createdAt ?? null,
          scheduledAt: null,
        });
      }

      for (const edge of scheduledData.posts?.edges ?? []) {
        const n = edge.node;
        posts.push({
          id: n.id,
          text: n.text ?? "",
          status: "scheduled",
          platforms: [channelToPlatform.get(n.channelId) ?? "unknown"],
          createdAt: n.createdAt ?? null,
          scheduledAt: n.dueAt ?? null,
        });
      }

      return posts.slice(0, limit);
    } catch {
      return [];
    }
  }

  async deletePost(postId: string): Promise<boolean> {
    try {
      const data = await this.gql<{ deletePost: { post?: { id: string }; message?: string } }>(`
        mutation DeletePost {
          deletePost(input: { postId: "${postId}" }) {
            ... on PostActionSuccess {
              post { id }
            }
            ... on MutationError {
              message
            }
          }
        }
      `);
      return !!data.deletePost?.post?.id;
    } catch {
      return false;
    }
  }

  async getAnalytics(_postId: string): Promise<PostAnalytics> {
    // Buffer's new GraphQL API does not expose per-post analytics yet
    return { impressions: 0, likes: 0, shares: 0, comments: 0 };
  }

  async getAccountAnalytics(profileId: string): Promise<AccountAnalytics> {
    // Buffer's new GraphQL API does not expose account analytics yet
    return { followers: 0, following: 0, posts: 0 };
  }

  async getComments(_postId: string): Promise<SocialComment[]> {
    // Buffer API does not expose comment threads
    return [];
  }

  async replyToComment(_postId: string, _commentId: string | null, _text: string): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: "Buffer does not support comment management via API" };
  }
}
