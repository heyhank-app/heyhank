// Social Media Types

export type SocialBackendId = "postiz" | "buffer";

export type SocialPlatform = "twitter" | "instagram" | "linkedin" | "facebook" | "tiktok" | "threads";

/**
 * Format hint for backends that distinguish post types (currently Postiz for IG/FB):
 * - "post"     — regular feed post (single image or text only)
 * - "carousel" — feed post with multiple images (IG auto-detects from media count;
 *                this label is for UI badges + agent intent tracking)
 * - "story"    — 24h Story. For multi-frame stories, Postiz publishes each media
 *                in mediaUrls as a separate Story automatically — do NOT split.
 * - "reel"     — short-form video. Requires a video in mediaUrls. Postiz routes
 *                IG video uploads through media_type=REELS automatically.
 *
 * Platforms that don't have this distinction (LinkedIn, X, TikTok, Threads) ignore
 * the field. If undefined, the adapter falls back to "post".
 */
export type SocialPostFormat = "post" | "carousel" | "story" | "reel";

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
  format?: SocialPostFormat;
  // Rich post fields (Buffer-style)
  title?: string;
  firstComment?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  isDraft?: boolean;
  /** Remix/attribution metadata stored on draft posts (not overwritten by backend publishing) */
  initialBackendData?: unknown;
}

export interface SocialPost {
  id: string;
  text: string;
  platforms: SocialPlatform[];
  scheduledAt?: string | null;
  mediaUrls: string[];
  format?: SocialPostFormat;
  status: "published" | "scheduled" | "failed" | "draft" | "partial" | "archived";
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
  /**
   * Opt-out flag: when true, the post-publish hook does NOT auto-create an
   * Auto-DM rule even if a `Comment WORD` trigger is detected in the body.
   * Useful for one-off posts where the user wants to handle DMs manually.
   */
  isAutoDmRuleSkipped?: boolean;
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
  /**
   * Platforms for which posting should use the BrowserAdapter (persistent
   * Playwright session via SocialView) instead of the primary backend (Postiz).
   * v1 supports only "twitter" and "tiktok".
   */
  browserPlatforms?: SocialPlatform[];
  /**
   * Per-platform backend override. Maps a platform to a specific backend that
   * should handle it, overriding `backend` (the primary). Platforms not in this
   * map fall back to `backend`. Example: `{ tiktok: "buffer" }` keeps Postiz as
   * primary for IG/FB/LinkedIn but routes TikTok through Buffer.
   * `browserPlatforms` takes precedence over this map.
   */
  platformBackends?: Partial<Record<SocialPlatform, SocialBackendId>>;
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
  browserPlatforms: [],
  platformBackends: {},
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
