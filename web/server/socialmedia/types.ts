// Social Media Types

export type SocialBackendId = "postiz" | "buffer";

export type SocialPlatform = "twitter" | "instagram" | "linkedin" | "facebook" | "tiktok" | "threads";

export interface SocialBackendConfig {
  url?: string;        // For Postiz (self-hosted URL)
  apiKey: string;
}

export interface SocialProfile {
  id: string;
  platform: SocialPlatform;
  name: string;
  picture?: string | null;
}

export interface CreatePostInput {
  text: string;
  platforms: SocialPlatform[];
  scheduledAt?: string | null;
  mediaUrls?: string[];
  // Rich post fields (Buffer-style)
  title?: string;
  firstComment?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  isDraft?: boolean;
}

export interface SocialPost {
  id: string;
  text: string;
  platforms: SocialPlatform[];
  scheduledAt?: string | null;
  mediaUrls: string[];
  status: "published" | "scheduled" | "failed" | "draft";
  backendId: SocialBackendId | null;
  backendPostId?: string | null;
  backendData?: unknown;
  createdAt: string;
  updatedAt: string;
  // Rich post fields
  title?: string;
  firstComment?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  createdBy?: "user" | "gemini" | "agent";
}

export interface PostAnalytics {
  impressions: number;
  likes: number;
  shares: number;
  comments: number;
}

export interface AccountAnalytics {
  followers: number;
  following: number;
  posts: number;
}

export interface SocialComment {
  id: string;
  author: string;
  text: string;
  createdAt?: string;
  likes?: number;
}

export interface SocialMediaSettings {
  backend: SocialBackendId | null;
  backends: Partial<Record<SocialBackendId, SocialBackendConfig>>;
  defaultPlatforms: SocialPlatform[];
  requireApproval?: boolean;
}

export interface ListPostsOpts {
  status?: string;
  platform?: string;
  limit?: number;
}

export const DEFAULT_SOCIAL_SETTINGS: SocialMediaSettings = {
  backend: null,
  backends: {},
  defaultPlatforms: [],
  requireApproval: false,
};

// ─── Hashtag Pools ─────────────────────────────────────────────────────────

export interface HashtagPool {
  id: string;
  /** Business or brand name (e.g. "Ferienhaus Steiermark") */
  name: string;
  /** Industry/niche (e.g. "tourism", "saas", "fashion") */
  industry: string;
  /** Language for hashtags (e.g. "de", "en") */
  language: string;
  /** High-reach hashtags (>1M posts) */
  popular: string[];
  /** Medium-reach hashtags (100K-1M posts) */
  medium: string[];
  /** Niche/specific hashtags (<100K posts) */
  niche: string[];
  /** Branded hashtags (company-specific) */
  branded: string[];
  /** Hashtags to NEVER use (banned, irrelevant, competitor) */
  blocked: string[];
  createdAt: string;
  updatedAt: string;
}
