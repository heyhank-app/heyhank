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

/**
 * Distilled writing-style profile derived from all library posts of a single
 * handle. Used as an "instruction block" in the content-generation prompt so
 * the agent writes in the role-model's voice without us having to ship 5+ raw
 * example posts every time (token-efficient + interpretable).
 *
 * One profile per (platform, handle). Saved at:
 *   ~/.heyhank/socialview/style-profiles/<platform>-<handle>.json
 */
export interface StyleProfile {
  id: string;
  platform: SocialPlatform;
  handle: string;
  displayName: string;

  /** How many library posts the profile was distilled from. */
  basedOnPostCount: number;
  /** Library post IDs used in the analysis (for re-runs / audit). */
  basedOnPostIds: string[];

  /** Avg word count across analyzed posts. */
  averageWordCount: number;
  /** Coarse length descriptor — useful as a one-word hint to the LLM. */
  lengthCategory: "kompakt" | "mittel" | "lang";

  /** Common opening-hook patterns and their relative frequency [0..1]. */
  hookPatterns: Array<{
    type: string;
    frequency: number;
    examples: string[];
  }>;

  /** Common closing/CTA patterns and frequency. */
  ctaPatterns: Array<{
    type: string;
    frequency: number;
    examples: string[];
  }>;

  emojiStyle: "keine" | "sparsam" | "moderat" | "dicht";
  /** Frequently used emojis (most-common first). */
  emojiList: string[];

  hashtagStyle: "keine" | "wenige" | "viele";

  /** High-level content themes the handle posts about. */
  contentPillars: string[];

  /** Free-form description of voice/tone. */
  toneOfVoice: string;

  /**
   * Engagement strategy observed in the post-author's own comments under
   * their posts. Captures patterns like "antwortet mit Frage zurück" or
   * "ergänzt CTA in erstem Eigenkommentar". May be empty if no own-comments
   * were extracted.
   */
  commentEngagementPattern: string;

  /**
   * Synthesis of the visual style across all analyzed posts: composition,
   * color palette, recurring overlay patterns, production quality. Distilled
   * from the per-post image descriptions. Empty string if no images present.
   */
  visualStyle: string;

  /** Full LLM analysis as prose — for transparency / manual editing. */
  rawAnalysis: string;

  createdAt: string;
  updatedAt: string;
}
