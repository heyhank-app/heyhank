// ─── SocialView Types ────────────────────────────────────────────────────────
// Browser-based social media viewing tool. User logs in manually via noVNC,
// backend uses Playwright to navigate and extract posts on command.

export type SocialPlatform =
  | "instagram"
  | "twitter"
  | "linkedin"
  | "facebook"
  | "tiktok";

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  "instagram",
  "twitter",
  "linkedin",
  "facebook",
  "tiktok",
];

/** URLs the browser navigates to when opening a platform (login page or feed). */
export const PLATFORM_URLS: Record<SocialPlatform, string> = {
  instagram: "https://www.instagram.com/",
  twitter: "https://x.com/home",
  linkedin: "https://www.linkedin.com/feed/",
  facebook: "https://www.facebook.com/",
  tiktok: "https://www.tiktok.com/",
};

export interface SocialViewStatus {
  platform: SocialPlatform;
  running: boolean;
  /** Heuristic: true if current URL suggests user is logged in (not on login page). */
  loggedIn: boolean | null;
  currentUrl: string | null;
  startedAt: number | null;
}

/** A single post captured into the reference library — used as few-shot
 *  examples when the content agent generates new posts. */
export interface LibraryPost {
  id: string;
  platform: SocialPlatform;
  /** "own" = Markus's accounts, "role-model" = other top performers we learn from. */
  source: "own" | "role-model";
  url: string;
  author: {
    handle: string;
    displayName?: string;
    followers?: number;
    verified?: boolean;
  };
  text: string;
  /** First 1–2 sentences isolated — the opening hook. */
  hook: string;
  /** Detected call-to-action (question, link, imperative). Null if none detected. */
  cta: string | null;
  hashtags: string[];
  mentions: string[];
  media: Array<{
    type: "image" | "video";
    localPath: string | null;
    remoteUrl: string | null;
    /** Claude Vision description of the image/video frame. */
    description: string;
  }>;
  engagement: {
    likes: number | null;
    comments: number | null;
    shares: number | null;
    views: number | null;
    saves: number | null;
  };
  /** (likes + comments + shares) / followers. Used for quality filtering. */
  engagementRate: number | null;
  postType: "image" | "carousel" | "reel" | "video" | "text" | "unknown";
  postedAt: string | null;
  /** Manual tags set by user. */
  tags: string[];
  /** Marked as gold standard after manual review. Only "gold" posts feed the agent. */
  isGold: boolean;
  /** When we captured this record. */
  extractedAt: string;
  notes: string;
}

export interface LibraryQuery {
  platform?: SocialPlatform;
  source?: "own" | "role-model";
  goldOnly?: boolean;
  minEngagementRate?: number;
  tags?: string[];
  limit?: number;
}
