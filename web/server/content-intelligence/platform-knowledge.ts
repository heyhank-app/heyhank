// ─── Platform Knowledge Base ─────────────────────────────────────────────────
// Comprehensive, research-backed best practices for all major social media
// platforms. Used by the Content Engine to generate platform-optimized content.
// Data sourced from Hootsuite, Sprout Social, Buffer, Socialinsider, Later,
// vidIQ, TubeBuddy, and others — April 2026.

export interface PlatformSpec {
  name: string;
  key: string;

  // Demographics
  demographics: {
    monthlyActiveUsers: string;
    largestAgeGroup: string;
    genderSplit: string;
    coreAudience: string;
    avgTimeSpent: string;
  };

  // Posting schedule
  bestTimes: {
    bestDays: string[];
    bestHours: string;
    worstTimes: string;
    timezone: string;
  };

  // Frequency
  frequency: {
    recommended: string;
    minimum: string;
    maximum: string;
    notes: string;
  };

  // Content formats ranked by performance
  formats: Array<{
    name: string;
    engagementRate: string;
    reachMultiplier: string;
    bestFor: string;
  }>;

  // Recommended content mix
  contentMix: Array<{
    format: string;
    percentage: string;
  }>;

  // Post specs
  postSpecs: {
    idealLength: string;
    maxLength: string;
    truncationPoint: string;
    videoMaxLength: string;
    videoIdealLength: string;
    videoAspectRatio: string;
    videoResolution: string;
    imageAspectRatio: string;
    imageResolution: string;
  };

  // Algorithm
  algorithm: {
    topSignals: string[];
    penalizedActions: string[];
    keyInsight: string;
  };

  // Hashtags
  hashtags: {
    optimal: string;
    placement: string;
    notes: string;
  };

  // Hook strategy
  hooks: {
    timeToHook: string;
    bestFormulas: string[];
    avoid: string[];
  };

  // Platform-specific features that boost reach
  boostFeatures: string[];

  // Common mistakes
  mistakes: string[];

  // Ad specs
  adSpecs: {
    bestFormat: string;
    bestAspectRatio: string;
    bestResolution: string;
    headlineLength: string;
    bodyLength: string;
  };
}

// ─── Facebook ────────────────────────────────────────────────────────────────

export const FACEBOOK: PlatformSpec = {
  name: "Facebook",
  key: "facebook",

  demographics: {
    monthlyActiveUsers: "3.07 billion",
    largestAgeGroup: "25-34 (24.2%)",
    genderSplit: "55.3% male, 44.7% female",
    coreAudience: "Millennials (25-34) and Gen X (35-54)",
    avgTimeSpent: "30-33 min/day",
  },

  bestTimes: {
    bestDays: ["Tuesday", "Wednesday"],
    bestHours: "12:00-8:00 PM local time",
    worstTimes: "4:00-7:00 AM across all days",
    timezone: "Audience local time",
  },

  frequency: {
    recommended: "3-5 feed posts/week + 2-4 Reels + daily Stories",
    minimum: "3 posts/week",
    maximum: "2 posts/day (over-posting causes scroll-past)",
    notes: "Consistency beats volume; algorithm rewards predictable rhythm",
  },

  formats: [
    { name: "Images", engagementRate: "5.20%", reachMultiplier: "1x (baseline)", bestFor: "Quick engagement" },
    { name: "Video/Reels", engagementRate: "4.84%", reachMultiplier: "3-5x reach", bestFor: "Discovery, new audience" },
    { name: "Carousels", engagementRate: "Higher than images", reachMultiplier: "1.5x", bestFor: "Swipe interaction, stories" },
    { name: "Text posts", engagementRate: "4.76%", reachMultiplier: "0.5x", bestFor: "Community discussion" },
    { name: "Link posts", engagementRate: "4.43%", reachMultiplier: "0.3x", bestFor: "Traffic (but penalized)" },
  ],

  contentMix: [
    { format: "Reels/short video", percentage: "50-60%" },
    { format: "Native images/carousels", percentage: "20-25%" },
    { format: "Facebook Live", percentage: "10-15%" },
    { format: "Polls/questions/UGC", percentage: "10%" },
  ],

  postSpecs: {
    idealLength: "40-80 characters (66% more engagement)",
    maxLength: "63,206 characters",
    truncationPoint: "125 chars mobile, 477 chars desktop",
    videoMaxLength: "90 seconds (Reels)",
    videoIdealLength: "15-60 seconds",
    videoAspectRatio: "9:16 vertical (Reels), 4:5 (feed)",
    videoResolution: "1080x1920 (Reels), 1080x1350 (feed)",
    imageAspectRatio: "1:1 or 4:5",
    imageResolution: "1080x1080 or 1080x1350",
  },

  algorithm: {
    topSignals: [
      "Saves and shares (most powerful)",
      "Substantive comments and conversations",
      "Content originality",
      "Recency (50% more same-day Reels surfaced)",
      "User relationship history",
      "Engagement velocity (first 30-60 min)",
    ],
    penalizedActions: [
      "Engagement bait ('Like if you agree') — 50-90% reach reduction",
      "Flagged trigger words — up to 80% reach reduction",
      "Clickbait headlines",
      "Reposted content/TikTok watermarks",
      "Excessive external links",
      "Recycled low-quality content",
    ],
    keyInsight: "All videos are now auto-classified as Reels. Saves > Shares > Comments > Likes in signal weight.",
  },

  hashtags: {
    optimal: "1-2 per post",
    placement: "Integrated naturally in the sentence",
    notes: "More than 3 hashtags REDUCES engagement. Facebook doesn't rely on hashtags for discovery.",
  },

  hooks: {
    timeToHook: "First line (125 chars on mobile before truncation)",
    bestFormulas: [
      "Open-ended questions inviting personal experience",
      "'Save this for later' as soft CTA",
      "Behind-the-scenes and authentic moments",
      "This-or-that comparisons with images",
    ],
    avoid: [
      "Generic CTAs like 'Like and share!'",
      "Only promotional content (use 80/20 rule: 80% value, 20% promo)",
    ],
  },

  boostFeatures: [
    "Facebook Groups (massive reach advantage, high-trust spaces)",
    "Facebook Live (significantly more engagement than pre-recorded)",
    "Facebook Events (bypass algorithm via notifications)",
    "Reels (3-5x reach of standard posts)",
  ],

  mistakes: [
    "Posting only promotional content",
    "Using engagement bait phrases",
    "Ignoring comments in the first hour",
    "Posting content with TikTok watermarks",
    "Over-relying on link posts",
  ],

  adSpecs: {
    bestFormat: "Video ads (feed) or Reels ads",
    bestAspectRatio: "4:5 (feed), 9:16 (Reels)",
    bestResolution: "1080x1350 (feed), 1080x1920 (Reels)",
    headlineLength: "~5 words",
    bodyLength: "~19 words",
  },
};

// ─── Instagram ───────────────────────────────────────────────────────────────

export const INSTAGRAM: PlatformSpec = {
  name: "Instagram",
  key: "instagram",

  demographics: {
    monthlyActiveUsers: "2+ billion",
    largestAgeGroup: "18-24 (31.7%) and 25-34 (30.6%)",
    genderSplit: "50.6% male, 49.4% female (global); 55.4% female in US",
    coreAudience: "Gen Z and Millennials (84% under 45)",
    avgTimeSpent: "33.9 min/day (53 min for 18-24)",
  },

  bestTimes: {
    bestDays: ["Tuesday", "Wednesday", "Thursday"],
    bestHours: "7-9 AM, 10 AM-2 PM, 5-9 PM local time",
    worstTimes: "Friday-Sunday (lowest engagement)",
    timezone: "Audience local time",
  },

  frequency: {
    recommended: "3-5 feed posts/week + 2-4 Reels + daily Stories (3-7/day)",
    minimum: "3 posts/week",
    maximum: "7 posts/week (diminishing returns beyond)",
    notes: "Doubling from 1-2 to 3-5 posts/week can more than double follower growth",
  },

  formats: [
    { name: "Carousels", engagementRate: "0.55% (highest)", reachMultiplier: "2x saves, 3x profile visits", bestFor: "Saves, loyalty, conversions" },
    { name: "Reels", engagementRate: "0.52%", reachMultiplier: "3-5x more reach", bestFor: "Discovery, new followers" },
    { name: "Mixed-media Carousels", engagementRate: "2.33%", reachMultiplier: "Very high", bestFor: "Only 7% use this — massive opportunity" },
    { name: "Static Images", engagementRate: "Declining (-17% YoY)", reachMultiplier: "Lowest", bestFor: "Aesthetic/culture posts only" },
  ],

  contentMix: [
    { format: "Reels", percentage: "60-70%" },
    { format: "Carousels", percentage: "20-30%" },
    { format: "Single Images", percentage: "10%" },
  ],

  postSpecs: {
    idealLength: "1-150 chars (short), 700-2200 chars (educational/saves)",
    maxLength: "2,200 characters",
    truncationPoint: "125 characters before 'more' on mobile",
    videoMaxLength: "3 minutes (Reels)",
    videoIdealLength: "7-15 seconds (virality), up to 90s (tutorials)",
    videoAspectRatio: "9:16 vertical",
    videoResolution: "1080x1920",
    imageAspectRatio: "4:5 portrait (recommended)",
    imageResolution: "1080x1350",
  },

  algorithm: {
    topSignals: [
      "DM sends/shares (#1 signal, especially for Reels)",
      "Saves (strong indicator of high-value content)",
      "Watch time / dwell time",
      "Shares (public reshares to Stories/feed)",
      "Meaningful comments (depth matters, not 'nice!')",
      "Likes (weakest signal)",
    ],
    penalizedActions: [
      "Reposting TikTok content with watermarks (explicitly de-ranked)",
      "Using banned hashtags (even one can make posts invisible)",
      "Bots/automation tools (mass-following, auto-liking)",
      "Buying followers/likes",
      "Rapid unnatural activity (>40 comments/hour triggers bot detection)",
      "Repetitive identical hashtags",
    ],
    keyInsight: "Keyword-rich captions generate ~30% more reach and 2x more likes than hashtag-heavy posts. Write captions for SEO.",
  },

  hashtags: {
    optimal: "3-5 for Reels, 5-7 for feed posts",
    placement: "In caption (36% more reach than comment placement)",
    notes: "Keyword-rich captions > hashtags for discovery. Instagram confirmed zero algorithmic difference between caption and comment, but caption gets indexed immediately.",
  },

  hooks: {
    timeToHook: "First 3 seconds for Reels (50% drop-off), first 125 chars for captions",
    bestFormulas: [
      "Bold on-screen text in first frame",
      "Curiosity questions",
      "Show the payoff first, then explain",
      "Pattern interrupts (unexpected visuals)",
    ],
    avoid: [
      "Slow intros or branding sequences",
      "Generic motivational quotes without unique angle",
    ],
  },

  boostFeatures: [
    "Collab posts (up to 5 collaborators, multiplies audience reach)",
    "Mixed-media carousels (image + video, only 7% use this)",
    "Interactive Stories (polls, quizzes, questions = 2x engagement)",
    "Remix features (duet-style for Reels)",
    "Product tagging (up to 30 products per Reel)",
  ],

  mistakes: [
    "Using only static images (declining -17% YoY)",
    "Hashtag stuffing (30 hashtags strategy is dead)",
    "Ignoring Reels (primary discovery engine)",
    "Not using captions/subtitles on video",
    "Posting TikTok watermarked content",
  ],

  adSpecs: {
    bestFormat: "Reels ads or Carousel ads",
    bestAspectRatio: "9:16 (Reels), 1:1 (Carousel)",
    bestResolution: "1080x1920 (Reels), 1080x1080 (Carousel)",
    headlineLength: "~40 characters",
    bodyLength: "~125 characters (before truncation)",
  },
};

// ─── TikTok ──────────────────────────────────────────────────────────────────

export const TIKTOK: PlatformSpec = {
  name: "TikTok",
  key: "tiktok",

  demographics: {
    monthlyActiveUsers: "2 billion",
    largestAgeGroup: "18-24 (36%) and 25-34 (32%)",
    genderSplit: "54% female, 46% male (global); 61% female in US",
    coreAudience: "Gen Z and young Millennials (avg age 26.5)",
    avgTimeSpent: "52 min/day (18-24), 34 min/day average",
  },

  bestTimes: {
    bestDays: ["Tuesday", "Wednesday", "Thursday"],
    bestHours: "6:00-11:00 PM weekdays; Sunday 9 AM is single best slot",
    worstTimes: "Weekday afternoons 12-5 PM",
    timezone: "Audience local time",
  },

  frequency: {
    recommended: "2-5 posts/week",
    minimum: "2 posts/week",
    maximum: "5 posts/day (diminishing returns beyond)",
    notes: "Median views stay flat (~500) regardless of frequency. More posts = more viral lottery tickets.",
  },

  formats: [
    { name: "Educational/Edutainment", engagementRate: "2.8x higher AVD", reachMultiplier: "High", bestFor: "Saves, completion rates, search" },
    { name: "Entertainment/humor", engagementRate: "High shares", reachMultiplier: "Highest virality", bestFor: "Widest reach" },
    { name: "Personal storytelling", engagementRate: "Strong comments", reachMultiplier: "Medium", bestFor: "Trust, loyalty" },
    { name: "Before/after transformations", engagementRate: "High completion", reachMultiplier: "High", bestFor: "Built-in visual hook" },
    { name: "Behind-the-scenes", engagementRate: "Medium", reachMultiplier: "Medium", bestFor: "Authenticity, lo-fi content" },
  ],

  contentMix: [
    { format: "Community/value content (educational, entertaining)", percentage: "70%" },
    { format: "Interactive content (questions, duets, stitches)", percentage: "20%" },
    { format: "Brand storytelling (transparent, lo-fi)", percentage: "10%" },
  ],

  postSpecs: {
    idealLength: "Short, keyword-rich captions",
    maxLength: "4,000 characters",
    truncationPoint: "~150 characters before 'more'",
    videoMaxLength: "10 minutes (some accounts: 30 min)",
    videoIdealLength: "21-34 seconds (highest completion), 11-18s (virality)",
    videoAspectRatio: "9:16 vertical",
    videoResolution: "1080x1920",
    imageAspectRatio: "9:16",
    imageResolution: "1080x1920",
  },

  algorithm: {
    topSignals: [
      "Watch time and completion rate (40-50% of weight, threshold ~70%)",
      "Saves and shares (weighted above likes)",
      "Comment quality (depth matters more than count)",
      "Rewatches (strong quality signal)",
      "Production quality (lighting, audio, editing — NEW in 2026)",
      "Follower-first testing (shown to followers before broader distribution)",
    ],
    penalizedActions: [
      "Posting bursts after inactivity (7-14 day shadowban)",
      "10+ posts/day or mass liking/commenting",
      "Low-quality AI-generated content",
      "Copyright violations (especially business accounts)",
      "Misleading hooks that don't match content",
      "Banned/flagged hashtags",
    ],
    keyInsight: "TikTok is now a full search engine. Keywords must appear in spoken audio, on-screen text, AND captions for maximum discoverability.",
  },

  hashtags: {
    optimal: "3-5 per post",
    placement: "In caption",
    notes: "3-layer formula: 1 niche tag (<1M videos) + 2-3 thematic tags + 1 optional trending tag. #fyp still used but niche tags drive higher conversion.",
  },

  hooks: {
    timeToHook: "Less than 3 seconds (50% of viewers decide to swipe)",
    bestFormulas: [
      "Dual-hook: text overlay + voiceover simultaneously",
      "Curiosity gap: bold claim creating information gap",
      "Pattern interrupt: unexpected visuals, jump cuts",
      "Direct address: 'Stop scrolling if you...'",
    ],
    avoid: [
      "Misleading hooks that don't match content",
      "Slow intros or branding sequences",
      "Generic hooks without specific value proposition",
    ],
  },

  boostFeatures: [
    "TikTok Shop (live shopping = 22% higher conversion)",
    "Duets and Stitches (collaborative engagement)",
    "Trending audio (use within first week of trend)",
    "TikTok SEO (multi-layer keyword strategy)",
    "Creator account for full music library access",
  ],

  mistakes: [
    "Using business account when trending sounds are critical",
    "Posting overly polished/produced content (authenticity wins)",
    "Ignoring TikTok search optimization",
    "Not saying keywords in spoken audio",
    "Sudden scaling from low to aggressive posting",
  ],

  adSpecs: {
    bestFormat: "In-feed video ads (native-looking)",
    bestAspectRatio: "9:16",
    bestResolution: "1080x1920",
    headlineLength: "~12-30 characters",
    bodyLength: "~100 characters",
  },
};

// ─── LinkedIn ────────────────────────────────────────────────────────────────

export const LINKEDIN: PlatformSpec = {
  name: "LinkedIn",
  key: "linkedin",

  demographics: {
    monthlyActiveUsers: "310 million active (1.3B total members)",
    largestAgeGroup: "25-34 (33.4%)",
    genderSplit: "56.8% male, 43.2% female",
    coreAudience: "Professionals, B2B decision-makers, 54% US users earn >$100K",
    avgTimeSpent: "~7-10 min/session",
  },

  bestTimes: {
    bestDays: ["Tuesday", "Wednesday", "Thursday"],
    bestHours: "10:00 AM - 2:00 PM local time",
    worstTimes: "Saturday and Sunday (lowest engagement)",
    timezone: "Target audience local time",
  },

  frequency: {
    recommended: "2-5 posts/week",
    minimum: "1 post/week",
    maximum: "1 post/day (second post suppresses first)",
    notes: "2-5 posts/week = +1,182 impressions per post vs 1/week. Consistency beats quantity.",
  },

  formats: [
    { name: "Carousel/Document (PDF)", engagementRate: "7.00-21.77% (highest)", reachMultiplier: "585% more than text", bestFor: "Dwell time, saves, authority" },
    { name: "Polls", engagementRate: "4.40%", reachMultiplier: "High", bestFor: "One-click engagement, market research" },
    { name: "Multi-image posts", engagementRate: "5-6%", reachMultiplier: "High", bestFor: "Likes, visual storytelling" },
    { name: "Video", engagementRate: "3.5-4%", reachMultiplier: "Medium", bestFor: "Vertical 9:16 with captions" },
    { name: "Text-only", engagementRate: "2-4%", reachMultiplier: "Medium", bestFor: "Personal stories, sharp writing" },
    { name: "External link posts", engagementRate: "1.5-2%", reachMultiplier: "40-60% reach PENALTY", bestFor: "Avoid — put link in first comment" },
  ],

  contentMix: [
    { format: "Carousel/Document (PDF)", percentage: "40%" },
    { format: "Text + image posts", percentage: "25%" },
    { format: "Video (vertical, native)", percentage: "20%" },
    { format: "Polls and engagement posts", percentage: "15%" },
  ],

  postSpecs: {
    idealLength: "1,300-2,500 characters (200-400 words)",
    maxLength: "3,000 characters",
    truncationPoint: "140 chars mobile, 210 chars desktop (before 'see more')",
    videoMaxLength: "15 min (desktop), 10 min (mobile)",
    videoIdealLength: "30 seconds - 3 minutes",
    videoAspectRatio: "9:16 vertical (preferred) or 1:1 square",
    videoResolution: "1080p minimum",
    imageAspectRatio: "1:1 or 4:5",
    imageResolution: "1080x1080 or 1080x1350",
  },

  algorithm: {
    topSignals: [
      "Dwell time (#1 factor — carousels win here)",
      "Relevance and topic match (LinkedIn builds your 'topic DNA')",
      "Comment quality (10+ words from relevant people = 5-7x weight)",
      "Saves/bookmarks (1 save = ~5x a like, ~2x a comment)",
      "Expertise and authority (original insights, data, actionable advice)",
      "Engagement velocity (first 60-90 min = 70% of total reach)",
    ],
    penalizedActions: [
      "External links in post body (40-60% reach reduction)",
      "Engagement pods (shadow ban, 60-90 day recovery)",
      "Engagement bait ('Comment YES to get...')",
      "5+ hashtags (spam flag)",
      "Posting more than 1x per day (cannibalization)",
      "Editing post within first hour (resets distribution)",
      "Tagging people who don't engage",
      "High-volume cold DMs ('Volume Tax' penalty)",
      "Generic/AI-generated comments (pattern detection)",
    ],
    keyInsight: "Personal profiles get 561% more reach and 5-8x more engagement than company pages. LinkedIn is a personal-brand platform.",
  },

  hashtags: {
    optimal: "3-5 per post",
    placement: "End of post, never scattered in text",
    notes: "LinkedIn removed hashtag following in 2024-2025. Hashtags now function as SEO keywords for LinkedIn search only.",
  },

  hooks: {
    timeToHook: "First 140 characters (mobile truncation point)",
    bestFormulas: [
      "Contrarian statement: 'Most LinkedIn advice is making you invisible.'",
      "Specific result + tease: 'I grew from 500 to 15K followers in 90 days.'",
      "Challenge a belief: 'You don't need to post every day.'",
      "Personal story opener: 'I got fired on a Tuesday.'",
      "Question that creates tension",
    ],
    avoid: [
      "Corporate/polished headlines that feel like ad copy",
      "Clickbait without payoff",
      "Generic motivational openings",
    ],
  },

  boostFeatures: [
    "Carousel/Document posts (PDF uploads — 21.77% engagement)",
    "LinkedIn Newsletter (25-35% open rates, auto-invites new followers)",
    "Strategic commenting on others' posts (5 thoughtful comments/day)",
    "Employee advocacy (7x higher lead conversion via personal profiles)",
    "Reply to all comments within 60 min (doubles engagement)",
  ],

  mistakes: [
    "Posting external links in post body (put in first comment)",
    "Using company page instead of personal profile for organic reach",
    "Posting more than once per day",
    "Using engagement pods (coordinated activity detection is aggressive)",
    "Editing posts within the first hour",
    "Generic AI-generated comments",
  ],

  adSpecs: {
    bestFormat: "Carousel ads or Document ads",
    bestAspectRatio: "1:1 (carousel) or 4:5 (single image)",
    bestResolution: "1080x1080 or 1080x1350",
    headlineLength: "~70 characters",
    bodyLength: "~150 characters (before truncation)",
  },
};

// ─── X (Twitter) ─────────────────────────────────────────────────────────────

export const X_TWITTER: PlatformSpec = {
  name: "X (Twitter)",
  key: "x",

  demographics: {
    monthlyActiveUsers: "557 million",
    largestAgeGroup: "25-34 (37.5%) and 18-24 (32.1%)",
    genderSplit: "63.7% male, 36.3% female",
    coreAudience: "18-34 covers ~70% of user base. News/tech/politics oriented.",
    avgTimeSpent: "28 min/day globally, 34 min/day in US",
  },

  bestTimes: {
    bestDays: ["Tuesday", "Wednesday", "Thursday"],
    bestHours: "9:00 AM - 2:00 PM local time",
    worstTimes: "Saturday (worst day overall)",
    timezone: "Audience local time",
  },

  frequency: {
    recommended: "3-5 posts/day",
    minimum: "1 post/day",
    maximum: "15-30/day only if quality maintained",
    notes: "Algorithm penalizes high volume with low per-post engagement. The 70/30 rule: spend 70% replying to others, 30% on original posts.",
  },

  formats: [
    { name: "Text", engagementRate: "3.56% (highest!)", reachMultiplier: "Baseline", bestFor: "X is the ONLY platform where text beats video" },
    { name: "Images", engagementRate: "3.40%", reachMultiplier: "~2x algorithmic boost", bestFor: "Visual complement to text" },
    { name: "Video", engagementRate: "2.96%", reachMultiplier: "~2x", bestFor: "Engagement, watch time" },
    { name: "Threads (8-12 tweets)", engagementRate: "63% more impressions", reachMultiplier: "High", bestFor: "Long-form, storytelling, authority" },
    { name: "Polls", engagementRate: "+21% vs average", reachMultiplier: "Medium", bestFor: "Lowest-friction engagement" },
    { name: "Link posts", engagementRate: "~0% (non-Premium!)", reachMultiplier: "Near zero", bestFor: "AVOID without Premium" },
  ],

  contentMix: [
    { format: "Text + image posts", percentage: "40%" },
    { format: "Pure text", percentage: "25%" },
    { format: "Threads", percentage: "15%" },
    { format: "Video", percentage: "10%" },
    { format: "Polls and questions", percentage: "10%" },
  ],

  postSpecs: {
    idealLength: "71-100 characters (17% higher engagement)",
    maxLength: "280 characters (free), 25,000 (Premium)",
    truncationPoint: "280 characters (no truncation on free)",
    videoMaxLength: "2:20 (free), 4 hours (Premium+)",
    videoIdealLength: "Under 2 minutes 20 seconds",
    videoAspectRatio: "9:16 vertical preferred, 16:9 or 1:1",
    videoResolution: "1080x1920 (vertical), 1280x720 (landscape)",
    imageAspectRatio: "16:9 or 1:1",
    imageResolution: "1200x675 or 1080x1080",
  },

  algorithm: {
    topSignals: [
      "Reply-to-reply chain (75x weight of a like)",
      "Conversation: reply + author reply back (150x!)",
      "Reply (27x a like)",
      "Repost/Retweet (20x a like)",
      "Dwell time (time-on-post is #1 metric in 2026)",
      "Engagement velocity (first 30 minutes critical)",
      "TweepCred score (hidden reputation 0-100, below 65 = only 3 tweets distributed)",
      "Premium status (4x in-network boost, 2x out-of-network)",
    ],
    penalizedActions: [
      "External links (non-Premium): near-zero engagement since March 2026",
      "3+ hashtags per tweet",
      "Starting tweets with hashtags",
      "Follow/unfollow tactics (#1 shadowban trigger)",
      "Engagement pods / auto-engagement",
      "Mass unfollowing events (can trigger 3-month shadowban)",
      ">50 follows/day, >100 likes/hour, >50 retweets/hour, >30 replies/hour",
    ],
    keyInsight: "X is pay-to-play. Premium gets 6-10x more reach. Free accounts get near-zero link engagement. Conversations (reply chains) are the most powerful signal (150x a like).",
  },

  hashtags: {
    optimal: "1-2 per tweet",
    placement: "Mid-tweet (never start with hashtag)",
    notes: "1-2 hashtags = 21-55% more engagement. 3+ = looks like bot. AI understands content without hashtags now.",
  },

  hooks: {
    timeToHook: "First line (entire tweet visible, no truncation at 280)",
    bestFormulas: [
      "Bold claim that challenges conventional wisdom",
      "Specific number or result",
      "Contrarian take on industry trend",
      "Personal story with unexpected twist",
    ],
    avoid: [
      "Generic motivational content",
      "Engagement bait",
    ],
  },

  boostFeatures: [
    "X Premium (6-10x reach boost, mandatory for serious marketing)",
    "Threads (8-12 tweets, 63% more impressions than single tweets)",
    "Reply strategy (70% time replying, 30% original content)",
    "X Communities (67% engagement increase)",
    "X Spaces (live audio for authority building)",
  ],

  mistakes: [
    "Not having X Premium (visibility is directly tied to subscription)",
    "Posting external links without Premium (0% engagement)",
    "Using 3+ hashtags",
    "Starting tweets with hashtags",
    "Follow/unfollow tactics",
    "Ignoring replies (conversations are 150x more valuable than likes)",
  ],

  adSpecs: {
    bestFormat: "Image or video ads",
    bestAspectRatio: "16:9 (landscape) or 1:1 (square)",
    bestResolution: "1200x675 or 1080x1080",
    headlineLength: "~70 characters",
    bodyLength: "~280 characters",
  },
};

// ─── YouTube ─────────────────────────────────────────────────────────────────

export const YOUTUBE: PlatformSpec = {
  name: "YouTube",
  key: "youtube",

  demographics: {
    monthlyActiveUsers: "2.85 billion",
    largestAgeGroup: "15-34 (largest combined segment)",
    genderSplit: "54.3% male, 45.7% female (global); 51.2% female in US",
    coreAudience: "Broadest of all platforms. 55+ is fastest-growing segment.",
    avgTimeSpent: "27 hours/month per user",
  },

  bestTimes: {
    bestDays: ["Sunday", "Tuesday", "Monday"],
    bestHours: "Long-form: 8-11 AM; Shorts: 6-9 PM",
    worstTimes: "Upload 2-3 hours before audience peak for indexing",
    timezone: "Target audience local time",
  },

  frequency: {
    recommended: "1-2 long-form/week + 3-5 Shorts/week",
    minimum: "1 long-form/week + 2-3 Shorts/week",
    maximum: "3+/week long-form only if quality maintained",
    notes: "Channels posting 12+/month grow views 8x faster. Quality > quantity always. Hybrid (Shorts + long-form) grows subs 3x faster.",
  },

  formats: [
    { name: "Shorts (50-60 sec)", engagementRate: "5.91%", reachMultiplier: "74% views from non-subscribers", bestFor: "Discovery, sub growth (29.2 subs per 10K views)" },
    { name: "Long-form (8-15 min)", engagementRate: "Lower but deeper", reachMultiplier: "5-10x higher RPM", bestFor: "Revenue, authority, SEO" },
    { name: "Community posts (polls)", engagementRate: "Highest in community", reachMultiplier: "Keeps algorithm presence", bestFor: "Between-upload visibility" },
  ],

  contentMix: [
    { format: "Long-form videos (8-15 min)", percentage: "40%" },
    { format: "YouTube Shorts (50-60 sec)", percentage: "40%" },
    { format: "Community posts", percentage: "20%" },
  ],

  postSpecs: {
    idealLength: "Title: 60-70 characters, front-load keyword in first 50",
    maxLength: "Title: 100 chars, Description: 5,000 chars",
    truncationPoint: "Title truncates at ~60 chars on mobile",
    videoMaxLength: "12 hours (or 256 GB)",
    videoIdealLength: "Long-form: 8-15 min (8 min minimum for mid-roll ads). Shorts: 50-60 sec.",
    videoAspectRatio: "16:9 (long-form), 9:16 (Shorts)",
    videoResolution: "1920x1080 (long-form), 1080x1920 (Shorts)",
    imageAspectRatio: "16:9 (thumbnails)",
    imageResolution: "1280x720 (thumbnails)",
  },

  algorithm: {
    topSignals: [
      "Watch time / Average View Duration (AVD) — ~50% weight",
      "Engagement rate (likes, comments, shares) — ~25%",
      "Click-through rate (CTR from title+thumbnail) — ~25%",
      "Satisfaction signals (surveys, repeat views, shares)",
      "Session time (does your video lead to more watching?)",
      "~70% of watch time comes from recommendations, not search",
    ],
    penalizedActions: [
      "Keyword stuffing in title/tags (NLP detects intent now)",
      "Misleading thumbnails/titles (CTR without watch time hurts)",
      "Irrelevant tags (verified by AI)",
      "Clickbait without payoff",
      "Long intros (viewers drop off before content starts)",
    ],
    keyInsight: "Shorts and long-form are fully independent systems. Posting Shorts won't hurt/help long-form. Long-form (15+ min) is only 8% of uploads but accounts for 50% of total engagement.",
  },

  hashtags: {
    optimal: "8-12 tags per video (only first 15 counted)",
    placement: "Tags field + keywords naturally in description",
    notes: "Tags carry less weight than title/description. YouTube AI verifies tag relevance — irrelevant tags are penalized.",
  },

  hooks: {
    timeToHook: "Shorts: 3 seconds. Long-form: 30 seconds (70%+ retention target).",
    bestFormulas: [
      "Cliffhanger/question: 'I thought I understood YouTube... until this.'",
      "Time-bound promise: 'In the next 60 seconds, I'll show you...'",
      "Stakes-based: Make viewers feel the cost of NOT watching",
      "Show a clip from later in the video (teaser)",
      "Cut intros entirely or keep under 5 seconds",
    ],
    avoid: [
      "Logo intros",
      "'Hey guys, welcome back' openings",
      "Slow build-up without immediate value",
    ],
  },

  boostFeatures: [
    "Thumbnail A/B testing (YouTube Studio Test & Compare, up to 3 variants)",
    "Chapters/timestamps (appear in Google search as key moments)",
    "End screens (extend session time — key satisfaction signal)",
    "Community posts between uploads (2-4/week, polls perform best)",
    "Hybrid strategy (Shorts + long-form = 3x faster sub growth)",
    "'Hype' feature for channels 500-500K subs",
  ],

  mistakes: [
    "Not A/B testing thumbnails",
    "Long intros or branding sequences",
    "Ignoring Shorts (primary discovery engine)",
    "Not saying keywords in spoken audio (auto-captions are indexed)",
    "Posting less than 1/week (lose recommendation queue in 30-60 days)",
    "Ignoring Community tab between uploads",
  ],

  adSpecs: {
    bestFormat: "Skippable in-stream or Shorts ads",
    bestAspectRatio: "16:9 (in-stream), 9:16 (Shorts)",
    bestResolution: "1920x1080 (in-stream), 1080x1920 (Shorts)",
    headlineLength: "~30 characters",
    bodyLength: "~90 characters",
  },
};

// ─── Exports ─────────────────────────────────────────────────────────────────

export const ALL_PLATFORMS: PlatformSpec[] = [
  FACEBOOK,
  INSTAGRAM,
  TIKTOK,
  LINKEDIN,
  X_TWITTER,
  YOUTUBE,
];

export function getPlatform(key: string): PlatformSpec | undefined {
  return ALL_PLATFORMS.find(p => p.key === key.toLowerCase());
}

export function getPlatformNames(): string[] {
  return ALL_PLATFORMS.map(p => p.name);
}

// ─── Cross-Platform Summary (for system prompts) ────────────────────────────

export function buildPlatformSummary(platformKey: string): string {
  const p = getPlatform(platformKey);
  if (!p) return `Unknown platform: ${platformKey}`;

  return `## ${p.name} Best Practices
- **Post when:** ${p.bestTimes.bestDays.join(", ")} at ${p.bestTimes.bestHours}
- **Frequency:** ${p.frequency.recommended}
- **Best format:** ${p.formats[0]?.name} (${p.formats[0]?.engagementRate} engagement)
- **Post length:** ${p.postSpecs.idealLength}
- **Hashtags:** ${p.hashtags.optimal}, ${p.hashtags.placement}
- **Video:** ${p.postSpecs.videoIdealLength} at ${p.postSpecs.videoAspectRatio}
- **Top algorithm signal:** ${p.algorithm.topSignals[0]}
- **Key insight:** ${p.algorithm.keyInsight}
- **Avoid:** ${p.mistakes.slice(0, 3).join("; ")}
- **Hook:** ${p.hooks.timeToHook}`;
}

export function buildAllPlatformsSummary(): string {
  return ALL_PLATFORMS.map(p => buildPlatformSummary(p.key)).join("\n\n");
}
