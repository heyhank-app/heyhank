import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api.js";
import { SocialViewTab } from "./SocialViewTab.js";
import { SocialLibraryTab } from "./SocialLibraryTab.js";
import { PersonasTab } from "./PersonasTab.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SocialPost {
  id: string;
  text: string;
  status: string;
  platforms: string[];
  createdAt: string;
  scheduledAt?: string | null;
  title?: string;
  firstComment?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  mediaUrls?: string[];
  createdBy?: "user" | "gemini" | "agent";
}

interface SocialProfile {
  id: string;
  platform: string;
  name: string;
  picture?: string | null;
}

interface SocialComment {
  id: string;
  author: string;
  text: string;
  createdAt?: string;
  likes?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_PLATFORMS = ["twitter", "instagram", "linkedin", "facebook", "tiktok", "threads"] as const;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const PLATFORM_ICONS: Record<string, string> = {
  twitter: "𝕏",
  instagram: "📷",
  linkedin: "in",
  facebook: "f",
  tiktok: "♪",
  threads: "@",
};

type TabId = "posts" | "drafts" | "calendar" | "view" | "library" | "personas" | "analytics" | "settings";

/**
 * Defensive normalization: a regression in the agent flow saved drafts with
 * `platforms` as `[{id, name}]` objects instead of the schema-required
 * `string[]`. Rendering an object as a JSX child crashed the Drafts tab.
 * This coerces both shapes back to a clean string array.
 */
function normalizePlatforms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const p of input) {
    if (typeof p === "string" && p) { out.push(p); continue; }
    if (p && typeof p === "object") {
      const o = p as { name?: unknown; platform?: unknown };
      if (typeof o.name === "string" && o.name) { out.push(o.name); continue; }
      if (typeof o.platform === "string" && o.platform) { out.push(o.platform); continue; }
    }
  }
  return out;
}

function normalizePost(p: SocialPost): SocialPost {
  return { ...p, platforms: normalizePlatforms(p.platforms) };
}
type PostFilter = "all" | "published" | "scheduled" | "failed" | "archived";
type PostSort = "newest" | "oldest";

/** Timestamp used for queue sorting: scheduled date if set, else updated/created. */
function postSortDate(p: { scheduledAt?: string | null; updatedAt?: string; createdAt?: string }): number {
  const raw = p.scheduledAt || p.updatedAt || p.createdAt;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function formatMetric(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function SocialMediaPage({ embedded }: { embedded?: boolean }) {
  // Read initial tab from URL hash (e.g. #/socialmedia/drafts)
  const initialTab = (() => {
    const hash = window.location.hash;
    const match = hash.match(/#\/socialmedia\/(\w+)/);
    if (match && ["posts", "drafts", "calendar", "view", "library", "personas", "analytics", "settings"].includes(match[1])) {
      return match[1] as TabId;
    }
    return "posts";
  })();
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function showMessage(text: string, isError = false) {
    setMessage(text);
    setMessageError(isError);
    setTimeout(() => setMessage(""), isError ? 5000 : 3000);
  }

  function refresh() { setRefreshKey((k) => k + 1); }

  function openComposer(post?: SocialPost) {
    setEditingPost(post || null);
    setShowComposer(true);
  }

  function closeComposer() {
    setShowComposer(false);
    setEditingPost(null);
  }

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "posts", label: "Queue" },
    { id: "drafts", label: "Drafts" },
    { id: "calendar", label: "Calendar" },
    { id: "view", label: "View" },
    { id: "library", label: "Library" },
    { id: "personas", label: "Personas" },
    { id: "analytics", label: "Analytics" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="h-full overflow-y-auto bg-cc-bg">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-safe space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-cc-fg">Social Media</h1>
          <button
            onClick={() => openComposer()}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 transition-colors"
          >
            + New Post
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-cc-border pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
                activeTab === tab.id
                  ? "bg-cc-accent/10 text-cc-accent border-b-2 border-cc-accent"
                  : "text-cc-muted hover:text-cc-fg"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Message */}
        {message && (
          <div className={`text-xs px-3 py-2 rounded-md ${messageError ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-green-500/10 text-green-400 border border-green-500/20"}`}>
            {message}
          </div>
        )}

        {/* Composer Overlay */}
        {showComposer && (
          <PostComposer
            post={editingPost}
            onClose={closeComposer}
            onSuccess={(msg) => { closeComposer(); showMessage(msg); refresh(); }}
            showMessage={showMessage}
          />
        )}

        {/* Tab Content */}
        {activeTab === "posts" && <QueueTab refreshKey={refreshKey} showMessage={showMessage} onEdit={openComposer} onRefresh={refresh} />}
        {activeTab === "drafts" && <DraftsTab refreshKey={refreshKey} showMessage={showMessage} onEdit={openComposer} onRefresh={refresh} />}
        {activeTab === "calendar" && <CalendarTab refreshKey={refreshKey} showMessage={showMessage} onEdit={openComposer} onRefresh={refresh} />}
        {activeTab === "view" && <SocialViewTab showMessage={showMessage} />}
        {activeTab === "library" && <SocialLibraryTab showMessage={showMessage} />}
        {activeTab === "personas" && <PersonasTab showMessage={showMessage} />}
        {activeTab === "analytics" && <AnalyticsTab showMessage={showMessage} />}
        {activeTab === "settings" && <SettingsTab showMessage={showMessage} onSwitchTab={setActiveTab} />}
      </div>
    </div>
  );
}

// ─── Post Composer ──────────────────────────────────────────────────────────

function PostComposer({ post, onClose, onSuccess, showMessage }: {
  post: SocialPost | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  showMessage: (text: string, isError?: boolean) => void;
}) {
  const [text, setText] = useState(post?.text || "");
  const [platforms, setPlatforms] = useState<string[]>(post?.platforms || []);
  const [title, setTitle] = useState(post?.title || "");
  const [firstComment, setFirstComment] = useState(post?.firstComment || "");
  const [mediaUrls, setMediaUrls] = useState(post?.mediaUrls?.join(", ") || "");
  const [videoUrl, setVideoUrl] = useState(post?.videoUrl || "");
  const [thumbnailUrl, setThumbnailUrl] = useState(post?.thumbnailUrl || "");
  const [scheduleMode, setScheduleMode] = useState<"now" | "schedule" | "draft">(
    post?.status === "draft" ? "draft" : post?.scheduledAt ? "schedule" : "now"
  );
  const [scheduleDate, setScheduleDate] = useState(
    post?.scheduledAt ? new Date(post.scheduledAt).toISOString().slice(0, 16) : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(!!(post?.firstComment || post?.videoUrl || post?.thumbnailUrl));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);

  const isEditing = !!post;
  const charCount = text.length;

  // Platform character limits
  const PLATFORM_LIMITS: Record<string, number> = {
    twitter: 280,
    instagram: 2200,
    facebook: 63206,
    linkedin: 3000,
    tiktok: 2200,
    threads: 500,
  };

  // Check which selected platforms exceed the limit
  const overLimitPlatforms = platforms.filter(
    (p) => PLATFORM_LIMITS[p] && charCount > PLATFORM_LIMITS[p],
  );
  const hasOverLimit = overLimitPlatforms.length > 0;

  // Find the tightest limit among selected platforms (for the main counter)
  const tightestLimit = platforms.reduce<number | null>((min, p) => {
    const limit = PLATFORM_LIMITS[p];
    if (!limit) return min;
    return min === null ? limit : Math.min(min, limit);
  }, null);

  function togglePlatform(p: string) {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  }

  async function handleMediaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadingMedia(true);
    try {
      const newUrls: string[] = [];
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(file);
        });
        const result = await api.uploadMedia(base64, file.type, file.name);
        newUrls.push(result.url);
      }
      const existing = mediaUrls.split(",").map((u) => u.trim()).filter(Boolean);
      setMediaUrls([...existing, ...newUrls].join(", "));
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Upload failed", true);
    } finally {
      setUploadingMedia(false);
      e.target.value = "";
    }
  }

  async function handleSubmit() {
    if (!text.trim()) { showMessage("Post text is required.", true); return; }
    if (!platforms.length) { showMessage("Select at least one platform.", true); return; }
    if (scheduleMode === "schedule" && !scheduleDate) { showMessage("Select a date and time.", true); return; }
    // Block publish if text exceeds any selected platform's character limit (drafts are OK)
    if (scheduleMode !== "draft" && hasOverLimit) {
      const details = overLimitPlatforms
        .map((p) => `${p.charAt(0).toUpperCase() + p.slice(1)}: ${charCount}/${PLATFORM_LIMITS[p]}`)
        .join(", ");
      showMessage(`Text too long for: ${details}`, true);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        text: text.trim(),
        platforms,
        scheduledAt: scheduleMode === "schedule" ? new Date(scheduleDate).toISOString() : null,
        mediaUrls: mediaUrls.split(",").map((u) => u.trim()).filter(Boolean),
        title: title.trim() || undefined,
        firstComment: firstComment.trim() || undefined,
        videoUrl: videoUrl.trim() || undefined,
        thumbnailUrl: thumbnailUrl.trim() || undefined,
        isDraft: scheduleMode === "draft",
        createdBy: "user" as const,
      };

      if (isEditing) {
        await api.updateSocialPost(post.id, payload);
        // PATCH only updates local fields — it does NOT push a draft to the
        // backend. If the user is transitioning a draft → scheduled/now,
        // explicitly call /publish so Postiz actually schedules/publishes.
        if (post.status === "draft" && scheduleMode !== "draft") {
          await api.publishSocialPost(post.id);
          onSuccess(scheduleMode === "schedule" ? "Post scheduled!" : "Post published!");
        } else {
          onSuccess("Post updated!");
        }
      } else {
        await api.createSocialPost(payload);
        onSuccess(scheduleMode === "draft" ? "Draft saved!" : scheduleMode === "schedule" ? "Post scheduled!" : "Post created!");
      }
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    } finally {
      setSubmitting(false);
    }
  }

  // Media preview URLs
  const mediaList = mediaUrls.split(",").map((u) => u.trim()).filter(Boolean);

  return (
    <div className="border border-cc-accent/30 rounded-xl bg-cc-card shadow-lg shadow-cc-accent/5 overflow-hidden">
      {/* Composer Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-cc-border/50 bg-cc-bg/50">
        <span className="text-xs font-medium text-cc-fg">{isEditing ? "Edit Post" : "New Post"}</span>
        <button onClick={onClose} className="text-cc-muted hover:text-cc-fg transition-colors text-sm leading-none">&times;</button>
      </div>

      <div className="p-4 space-y-3">
        {/* Platform Selector */}
        <div>
          <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1.5">Channels</label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_PLATFORMS.map((p) => (
              <button
                key={p}
                onClick={() => togglePlatform(p)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                  platforms.includes(p)
                    ? "bg-cc-accent/15 text-cc-accent border-cc-accent/40"
                    : "bg-cc-bg text-cc-muted border-cc-border hover:border-cc-accent/30 hover:text-cc-fg"
                }`}
              >
                <span className="text-[10px]">{PLATFORM_ICONS[p]}</span>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="w-full bg-transparent text-sm font-medium text-cc-fg placeholder:text-cc-muted/50 focus:outline-none"
        />

        {/* Text Area */}
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="What would you like to share?"
            className="w-full bg-cc-bg border border-cc-border rounded-lg p-3 text-sm text-cc-fg resize-y focus:outline-none focus:border-cc-accent/50 min-h-[100px]"
          />
          {tightestLimit !== null && (
            <div className="absolute bottom-2 right-2 flex gap-2">
              {platforms.map((p) => {
                const limit = PLATFORM_LIMITS[p];
                if (!limit) return null;
                const over = charCount > limit;
                return (
                  <span key={p} className={`text-[10px] ${over ? "text-red-400 font-medium" : "text-cc-muted"}`}>
                    {p === "twitter" ? "X" : p.charAt(0).toUpperCase() + p.slice(1)} {charCount}/{limit}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Media Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingMedia}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-cc-muted hover:text-cc-fg border border-cc-border rounded-md hover:border-cc-accent/30 transition-colors disabled:opacity-50"
            >
              {uploadingMedia ? "Uploading..." : "📎 Add Media"}
            </button>
            <button
              onClick={() => setShowMediaPicker(true)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-cc-muted hover:text-cc-fg border border-cc-border rounded-md hover:border-cc-accent/30 transition-colors"
            >
              🖼️ Media Library
            </button>
            <MediaPickerModal
              open={showMediaPicker}
              onClose={() => setShowMediaPicker(false)}
              onSelect={(urls) => {
                const existing = mediaUrls.split(",").map((u) => u.trim()).filter(Boolean);
                setMediaUrls([...existing, ...urls].join(", "));
              }}
            />
            <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple onChange={handleMediaUpload} className="hidden" />
            {mediaList.length > 0 && (
              <span className="text-[10px] text-cc-muted">{mediaList.length} file(s)</span>
            )}
          </div>
          {/* Media Preview */}
          {mediaList.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {mediaList.map((url, i) => (
                <div key={i} className="relative group shrink-0">
                  <img src={url} alt={`Media ${i + 1}`} className="h-20 w-20 rounded-lg border border-cc-border/50 object-cover" />
                  <button
                    onClick={() => {
                      const updated = mediaList.filter((_, j) => j !== i);
                      setMediaUrls(updated.join(", "));
                    }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Advanced Fields Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[10px] text-cc-muted hover:text-cc-fg transition-colors"
        >
          {showAdvanced ? "▾ Less options" : "▸ More options (first comment, video, thumbnail)"}
        </button>

        {showAdvanced && (
          <div className="space-y-2 pl-2 border-l-2 border-cc-border/30">
            <div>
              <label className="text-[10px] text-cc-muted block mb-1">First Comment (Instagram, LinkedIn)</label>
              <textarea
                value={firstComment}
                onChange={(e) => setFirstComment(e.target.value)}
                rows={2}
                placeholder="Hashtags, links, additional context..."
                className="w-full bg-cc-bg border border-cc-border rounded-md p-2 text-xs text-cc-fg resize-y focus:outline-none focus:border-cc-accent/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-cc-muted block mb-1">Video URL</label>
                <input
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-cc-bg border border-cc-border rounded-md p-2 text-xs text-cc-fg focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-cc-muted block mb-1">Thumbnail URL</label>
                <input
                  value={thumbnailUrl}
                  onChange={(e) => setThumbnailUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-cc-bg border border-cc-border rounded-md p-2 text-xs text-cc-fg focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Schedule Mode */}
        <div>
          <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1.5">When to post</label>
          <div className="flex gap-1.5">
            {([
              { id: "now", label: "Post Now" },
              { id: "schedule", label: "Schedule" },
              { id: "draft", label: "Save as Draft" },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setScheduleMode(opt.id)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all border ${
                  scheduleMode === opt.id
                    ? "bg-cc-accent/15 text-cc-accent border-cc-accent/40"
                    : "bg-cc-bg text-cc-muted border-cc-border hover:border-cc-accent/30"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {scheduleMode === "schedule" && (
          <input
            type="datetime-local"
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
            className="w-full bg-cc-bg border border-cc-border rounded-md p-2 text-xs text-cc-fg focus:outline-none focus:border-cc-accent/50"
          />
        )}

        {/* Submit */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 disabled:opacity-50 transition-colors"
          >
            {submitting
              ? "Saving..."
              : scheduleMode === "now"
                ? (isEditing ? "Update & Post" : "Post Now")
                : scheduleMode === "schedule"
                  ? (isEditing ? "Update & Schedule" : "Schedule")
                  : (isEditing ? "Update Draft" : "Save Draft")}
          </button>
          <button onClick={onClose} className="px-3 py-2 text-xs text-cc-muted hover:text-cc-fg transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Queue Tab (Published + Scheduled) ──────────────────────────────────────

function QueueTab({ refreshKey, showMessage, onEdit, onRefresh }: {
  refreshKey: number;
  showMessage: (text: string, isError?: boolean) => void;
  onEdit: (post: SocialPost) => void;
  onRefresh: () => void;
}) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [filter, setFilter] = useState<PostFilter>("all");
  const [platformFilter, setPlatformFilter] = useState("");
  const [sort, setSort] = useState<PostSort>("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadPosts = useCallback(async () => {
    try {
      // Pull a generous limit so archived posts are available for the Archived filter.
      const data = await api.listSocialPosts({ limit: 200 });
      setPosts(
        (data.posts || [])
          .filter((p: SocialPost) => p.status !== "draft")
          .map(normalizePost),
      );
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadPosts(); }, [loadPosts, refreshKey]);

  async function handleDelete(id: string) {
    try {
      await api.deleteSocialPost(id);
      showMessage("Post deleted.");
      loadPosts();
      onRefresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    }
  }

  async function handleArchive(id: string, archived: boolean) {
    try {
      if (archived) await api.archiveSocialPost(id);
      else await api.unarchiveSocialPost(id);
      showMessage(archived ? "Post archived." : "Post unarchived.");
      loadPosts();
      onRefresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filtered = posts
    .filter((p) => {
      // "all" hides archived by default — only the Archived filter shows them.
      if (filter === "all" ? p.status === "archived" : p.status !== filter) return false;
      if (platformFilter && !p.platforms.includes(platformFilter)) return false;
      return true;
    })
    .sort((a, b) => {
      const diff = postSortDate(b) - postSortDate(a);
      return sort === "newest" ? diff : -diff;
    });

  const visibleIds = filtered.map((p) => p.id);
  const visibleSelectedCount = visibleIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  /**
   * Run an async action for every selected post sequentially. Sequential
   * (not Promise.all) to avoid hammering the backend and to keep errors
   * attributable to a specific post.
   */
  async function runBulk(action: (id: string) => Promise<unknown>, verb: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try { await action(id); ok++; } catch { failed++; }
    }
    setBulkBusy(false);
    setSelected(new Set());
    showMessage(
      failed === 0
        ? `${verb} ${ok} post(s).`
        : `${verb} ${ok} post(s) — ${failed} failed.`,
      failed > 0,
    );
    loadPosts();
    onRefresh();
  }

  async function bulkArchive()   { await runBulk((id) => api.archiveSocialPost(id),   "Archived"); }
  async function bulkUnarchive() { await runBulk((id) => api.unarchiveSocialPost(id), "Unarchived"); }
  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} post(s)? This cannot be undone.`)) return;
    await runBulk((id) => api.deleteSocialPost(id), "Deleted");
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1">
          {(["all", "published", "scheduled", "failed", "archived"] as PostFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                filter === f ? "bg-cc-accent/15 text-cc-accent" : "text-cc-muted hover:text-cc-fg"
              }`}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="bg-cc-bg border border-cc-border rounded-md px-2 py-1 text-[10px] text-cc-fg focus:outline-none"
        >
          <option value="">All platforms</option>
          {ALL_PLATFORMS.map((p) => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
        <button
          onClick={() => setSort(sort === "newest" ? "oldest" : "newest")}
          title={sort === "newest" ? "Sorted: newest first. Click for oldest first." : "Sorted: oldest first. Click for newest first."}
          className="px-2 py-1 text-[10px] font-medium text-cc-muted hover:text-cc-fg bg-cc-bg border border-cc-border rounded-md transition-colors"
        >
          {sort === "newest" ? "↓ Newest" : "↑ Oldest"}
        </button>
        <label className="flex items-center gap-1.5 text-[10px] text-cc-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            // Indeterminate when some but not all visible posts are selected.
            ref={(el) => { if (el) el.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected; }}
            onChange={toggleSelectAllVisible}
            disabled={filtered.length === 0}
            className="accent-cc-accent"
          />
          Select all
        </label>
        <span className="text-[10px] text-cc-muted ml-auto">{filtered.length} post(s)</span>
      </div>

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-cc-accent/10 border border-cc-accent/30 rounded-md">
          <span className="text-[11px] font-medium text-cc-accent">{selected.size} selected</span>
          <div className="flex gap-1 ml-auto">
            <button
              onClick={bulkArchive}
              disabled={bulkBusy}
              className="px-2 py-1 text-[10px] font-medium text-cc-fg hover:bg-cc-hover rounded-md transition-colors disabled:opacity-50"
            >
              Archive
            </button>
            <button
              onClick={bulkUnarchive}
              disabled={bulkBusy}
              className="px-2 py-1 text-[10px] font-medium text-cc-fg hover:bg-cc-hover rounded-md transition-colors disabled:opacity-50"
            >
              Unarchive
            </button>
            <button
              onClick={bulkDelete}
              disabled={bulkBusy}
              className="px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-400/10 rounded-md transition-colors disabled:opacity-50"
            >
              Delete
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy}
              className="px-2 py-1 text-[10px] font-medium text-cc-muted hover:text-cc-fg hover:bg-cc-hover rounded-md transition-colors disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Post List */}
      {filtered.length === 0 ? (
        <EmptyState text={filter === "all" ? "No posts yet. Create your first post!" : `No ${filter} posts.`} />
      ) : (
        <div className="space-y-2">
          {filtered.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              selected={selected.has(post.id)}
              onToggleSelect={toggleSelected}
              onEdit={onEdit}
              onDelete={handleDelete}
              onArchive={handleArchive}
              showMessage={showMessage}
              onRefresh={() => { loadPosts(); onRefresh(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Drafts Tab ─────────────────────────────────────────────────────────────

function DraftsTab({ refreshKey, showMessage, onEdit, onRefresh }: {
  refreshKey: number;
  showMessage: (text: string, isError?: boolean) => void;
  onEdit: (post: SocialPost) => void;
  onRefresh: () => void;
}) {
  const [drafts, setDrafts] = useState<SocialPost[]>([]);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadDrafts = useCallback(async () => {
    try {
      const data = await api.listSocialPosts({ limit: 50, status: "draft" });
      setDrafts((data.posts || []).map(normalizePost));
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts, refreshKey]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const visibleIds = drafts.map((d) => d.id);
  const visibleSelectedCount = visibleIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  /**
   * Run an async action for every selected draft sequentially. Sequential
   * (not Promise.all) to avoid hammering the backend and to keep errors
   * attributable to a specific draft.
   */
  async function runBulk(action: (id: string) => Promise<unknown>, verb: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try { await action(id); ok++; } catch { failed++; }
    }
    setBulkBusy(false);
    setSelected(new Set());
    showMessage(
      failed === 0
        ? `${verb} ${ok} draft(s).`
        : `${verb} ${ok} draft(s) — ${failed} failed.`,
      failed > 0,
    );
    loadDrafts();
    onRefresh();
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} draft(s)? This cannot be undone.`)) return;
    await runBulk((id) => api.deleteSocialPost(id), "Deleted");
  }

  // Platform character limits (same as in PostComposer)
  const PLATFORM_LIMITS: Record<string, number> = {
    twitter: 280, instagram: 2200, facebook: 63206,
    linkedin: 3000, tiktok: 2200, threads: 500,
  };

  async function handlePublish(id: string) {
    // Pre-flight: check character limits before sending to backend
    const draft = drafts.find((d) => d.id === id);
    if (draft) {
      const textLen = draft.text.length;
      const over = draft.platforms.filter((p) => PLATFORM_LIMITS[p] && textLen > PLATFORM_LIMITS[p]);
      if (over.length > 0) {
        const details = over
          .map((p) => `${p.charAt(0).toUpperCase() + p.slice(1)}: ${textLen}/${PLATFORM_LIMITS[p]}`)
          .join(", ");
        showMessage(`Text too long for: ${details}. Edit the draft first.`, true);
        return;
      }
    }

    setPublishing(id);
    try {
      // publishDraft returns the updated post — status may be "failed" even on
      // a 200 response because the adapter swallows backend errors into the post.
      const result = await api.publishSocialPost(id);
      if (result?.status === "failed") {
        const backendErr = (result as { backendData?: { error?: unknown; message?: unknown; details?: unknown } }).backendData;
        const errMsg =
          (Array.isArray(backendErr?.message) ? backendErr.message.join(" • ") : backendErr?.message) ||
          (Array.isArray(backendErr?.details) ? backendErr.details.join(" • ") : backendErr?.details) ||
          backendErr?.error ||
          "Publish failed";
        showMessage(String(errMsg), true);
      } else {
        showMessage("Post published!");
      }
      loadDrafts();
      onRefresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to publish", true);
    } finally {
      setPublishing(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteSocialPost(id);
      showMessage("Draft deleted.");
      loadDrafts();
      onRefresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px] text-cc-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            // Indeterminate when some but not all visible drafts are selected.
            ref={(el) => { if (el) el.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected; }}
            onChange={toggleSelectAllVisible}
            disabled={drafts.length === 0}
            className="accent-cc-accent"
          />
          Select all
        </label>
        <span className="text-[10px] text-cc-muted ml-auto">{drafts.length} draft(s)</span>
      </div>

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-cc-accent/10 border border-cc-accent/30 rounded-md">
          <span className="text-[11px] font-medium text-cc-accent">{selected.size} selected</span>
          <div className="flex gap-1 ml-auto">
            <button
              onClick={bulkDelete}
              disabled={bulkBusy}
              className="px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-400/10 rounded-md transition-colors disabled:opacity-50"
            >
              Delete
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy}
              className="px-2 py-1 text-[10px] font-medium text-cc-muted hover:text-cc-fg hover:bg-cc-hover rounded-md transition-colors disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {drafts.length === 0 ? (
        <EmptyState text="No drafts. Drafts created by you, Gemini, or agents will appear here." />
      ) : (
        <div className="space-y-2">
          {drafts.map((draft) => (
            <PostCard
              key={draft.id}
              post={draft}
              selected={selected.has(draft.id)}
              onToggleSelect={toggleSelected}
              onEdit={onEdit}
              onDelete={handleDelete}
              showMessage={showMessage}
              onRefresh={() => { loadDrafts(); onRefresh(); }}
              onPublish={handlePublish}
              isPublishing={publishing === draft.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Post Card ──────────────────────────────────────────────────────────────

function PostCard({ post, selected, onToggleSelect, onEdit, onDelete, onArchive, showMessage, onRefresh, onPublish, isPublishing }: {
  post: SocialPost;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onEdit: (post: SocialPost) => void;
  onDelete: (id: string) => void;
  onArchive?: (id: string, archived: boolean) => void;
  showMessage: (text: string, isError?: boolean) => void;
  onRefresh: () => void;
  onPublish?: (id: string) => void;
  isPublishing?: boolean;
}) {
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<SocialComment[]>([]);
  const isDraft = post.status === "draft";
  const isArchived = post.status === "archived";
  const mediaList = post.mediaUrls || [];

  async function toggleComments() {
    if (showComments) { setShowComments(false); return; }
    try {
      const data = await api.getSocialPostComments(post.id);
      setComments(data.comments || []);
      setShowComments(true);
    } catch { setShowComments(true); }
  }

  async function handleReply(commentId: string | null, text: string) {
    try {
      const result = await api.replySocialComment(post.id, commentId, text);
      if (result.ok) {
        showMessage("Reply sent.");
        const data = await api.getSocialPostComments(post.id);
        setComments(data.comments || []);
      } else {
        showMessage(result.error || "Failed", true);
      }
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    }
  }

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${
      selected ? "bg-cc-accent/5 border-cc-accent/50" : isDraft ? "bg-cc-card border-yellow-500/25" : "bg-cc-card border-cc-border/50"
    }`}>
      <div className="p-3.5 space-y-2.5">
        {/* Header row: selection + title */}
        <div className="flex items-start gap-2">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelect(post.id)}
              aria-label="Select post"
              className="mt-0.5 accent-cc-accent cursor-pointer"
            />
          )}
          {post.title && (
            <h3 className="text-xs font-semibold text-cc-fg flex-1">{post.title}</h3>
          )}
        </div>

        {/* Text */}
        <p className="text-sm text-cc-fg whitespace-pre-wrap break-words leading-relaxed">{post.text}</p>

        {/* Media Preview */}
        {(post.thumbnailUrl || mediaList.length > 0) && (
          <div className="flex gap-2 overflow-x-auto">
            {post.thumbnailUrl && (
              <img src={post.thumbnailUrl} alt="Thumbnail" className="h-24 rounded-lg border border-cc-border/30 object-cover" />
            )}
            {mediaList.map((url, i) => (
              <img key={i} src={url} alt={`Media ${i + 1}`} className="h-24 rounded-lg border border-cc-border/30 object-cover" />
            ))}
          </div>
        )}

        {/* Video */}
        {post.videoUrl && (
          <div className="flex items-center gap-1.5 text-[10px] text-cc-muted bg-cc-bg rounded-md px-2 py-1">
            <span>🎬</span>
            <span className="truncate">{post.videoUrl}</span>
          </div>
        )}

        {/* First Comment */}
        {post.firstComment && (
          <div className="text-[11px] text-cc-muted/80 border-l-2 border-cc-accent/20 pl-2.5 italic">
            {post.firstComment}
          </div>
        )}

        {/* Badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={post.status} />
          {post.createdBy && <CreatedByBadge by={post.createdBy} />}
          {post.platforms.map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
          <span className="text-[10px] text-cc-muted ml-auto">
            {post.scheduledAt
              ? `Scheduled: ${new Date(post.scheduledAt).toLocaleString()}`
              : post.createdAt ? relativeTime(post.createdAt) : ""}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 px-3.5 py-2 border-t border-cc-border/30 bg-cc-bg/30">
        {isDraft && onPublish && (
          <button
            onClick={() => onPublish(post.id)}
            disabled={isPublishing}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-green-400 hover:bg-green-400/10 rounded-md transition-colors disabled:opacity-50"
          >
            {isPublishing ? "Publishing..." : "▶ Publish"}
          </button>
        )}
        <button
          onClick={() => onEdit(post)}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-cc-muted hover:text-cc-fg hover:bg-cc-hover rounded-md transition-colors"
        >
          Edit
        </button>
        <button
          onClick={toggleComments}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-cc-muted hover:text-cc-fg hover:bg-cc-hover rounded-md transition-colors"
        >
          Comments
        </button>
        {!isDraft && (
          <button
            onClick={async () => {
              if (!window.confirm(
                "Move this post back to drafts? This will delete the post from your social platform(s) (best-effort) so you can edit and re-publish.",
              )) return;
              try {
                await api.moveSocialPostToDraft(post.id);
                showMessage("Moved to drafts.");
                onRefresh();
              } catch (err) {
                showMessage(err instanceof Error ? err.message : "Failed", true);
              }
            }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-cc-muted hover:text-cc-fg hover:bg-cc-hover rounded-md transition-colors ml-auto"
          >
            ↩ Move to Draft
          </button>
        )}
        {onArchive && !isDraft && (
          <button
            onClick={() => onArchive(post.id, !isArchived)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-cc-muted hover:text-cc-fg hover:bg-cc-hover rounded-md transition-colors"
          >
            {isArchived ? "Unarchive" : "Archive"}
          </button>
        )}
        <button
          onClick={() => onDelete(post.id)}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-red-400/70 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors${onArchive && !isDraft ? "" : " ml-auto"}`}
        >
          Delete
        </button>
      </div>

      {/* Comments */}
      {showComments && (
        <div className="px-3.5 pb-3 border-t border-cc-border/30">
          <CommentsThread comments={comments} onReply={handleReply} />
        </div>
      )}
    </div>
  );
}

// ─── Comments ───────────────────────────────────────────────────────────────

function CommentsThread({ comments, onReply }: {
  comments: SocialComment[];
  onReply: (commentId: string | null, text: string) => void;
}) {
  return (
    <div className="pt-2.5 space-y-2">
      {comments.length === 0 && <p className="text-[10px] text-cc-muted">No comments.</p>}
      {comments.map((c) => (
        <div key={c.id} className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-cc-accent">{c.author}</span>
            <span className="text-[9px] text-cc-muted">{c.createdAt ? relativeTime(c.createdAt) : ""}</span>
            {c.likes ? <span className="text-[9px] text-cc-muted">· {c.likes} likes</span> : null}
          </div>
          <p className="text-[11px] text-cc-fg">{c.text}</p>
          <ReplyInput onSubmit={(text) => onReply(c.id, text)} placeholder="Reply..." />
        </div>
      ))}
      <ReplyInput onSubmit={(text) => onReply(null, text)} placeholder="New comment..." />
    </div>
  );
}

function ReplyInput({ onSubmit, placeholder }: { onSubmit: (text: string) => void; placeholder: string }) {
  const [text, setText] = useState("");
  return (
    <div className="flex gap-1.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-cc-bg border border-cc-border/50 rounded-md px-2 py-1 text-[10px] text-cc-fg focus:outline-none focus:border-cc-accent/50"
        onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { onSubmit(text.trim()); setText(""); } }}
      />
      <button
        onClick={() => { if (text.trim()) { onSubmit(text.trim()); setText(""); } }}
        className="text-[10px] text-cc-accent hover:text-cc-accent/80 transition-colors px-2"
      >
        Send
      </button>
    </div>
  );
}

// ─── Calendar Tab ───────────────────────────────────────────────────────────

function CalendarTab({ refreshKey, showMessage, onEdit, onRefresh }: {
  refreshKey: number;
  showMessage: (text: string, isError?: boolean) => void;
  onEdit: (post: SocialPost) => void;
  onRefresh: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [calData, setCalData] = useState<Record<string, SocialPost[]>>({});
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;

  const loadCalendar = useCallback(async () => {
    try {
      const data = await api.getSocialCalendar(monthStr);
      setCalData((data.days || {}) as Record<string, SocialPost[]>);
    } catch { /* silent */ }
  }, [monthStr]);

  useEffect(() => { loadCalendar(); }, [loadCalendar, refreshKey]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1);
    setSelectedDay(null);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1);
    setSelectedDay(null);
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let startDow = new Date(year, month, 1).getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;
  const todayStr = new Date().toISOString().slice(0, 10);

  async function handleReschedule(postId: string) {
    const newDate = prompt("New date/time (YYYY-MM-DDTHH:MM):");
    if (!newDate) return;
    try {
      await api.updateSocialPost(postId, { scheduledAt: new Date(newDate).toISOString() });
      showMessage("Post rescheduled.");
      loadCalendar();
      onRefresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    }
  }

  async function handleDeletePost(postId: string) {
    try {
      await api.deleteSocialPost(postId);
      showMessage("Post deleted.");
      loadCalendar();
      onRefresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    }
  }

  const dayPosts = selectedDay ? (calData[selectedDay] || []) : [];

  // Status color helpers
  const statusBorder: Record<string, string> = {
    published: "border-l-green-400",
    scheduled: "border-l-blue-400",
    draft: "border-l-yellow-400",
    failed: "border-l-red-400",
  };

  return (
    <div className="space-y-3">
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="px-2.5 py-1 text-cc-muted hover:text-cc-fg transition-colors rounded-md hover:bg-cc-hover text-sm">&larr;</button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-cc-fg">{MONTH_NAMES[month]} {year}</span>
          <button
            onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); setSelectedDay(null); }}
            className="text-[10px] px-2 py-0.5 rounded-md text-cc-muted hover:text-cc-fg border border-cc-border hover:border-cc-accent/30 transition-colors"
          >
            Today
          </button>
        </div>
        <button onClick={nextMonth} className="px-2.5 py-1 text-cc-muted hover:text-cc-fg transition-colors rounded-md hover:bg-cc-hover text-sm">&rarr;</button>
      </div>

      {/* Legend */}
      <div className="flex gap-3 justify-center text-[9px] text-cc-muted">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> Published</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" /> Scheduled</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" /> Draft</span>
      </div>

      {/* Calendar Grid — Buffer/Postiz style with post previews in cells */}
      <div className="grid grid-cols-7 gap-px bg-cc-border/30 rounded-xl overflow-hidden border border-cc-border/30">
        {/* Day headers */}
        {DAY_HEADERS.map((d) => (
          <div key={d} className="text-center text-[9px] font-semibold text-cc-muted py-2 bg-cc-bg uppercase tracking-wider">{d}</div>
        ))}
        {/* Empty leading cells */}
        {Array.from({ length: startDow }).map((_, i) => (
          <div key={`e-${i}`} className="min-h-[90px] bg-cc-bg/50" />
        ))}
        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = `${monthStr}-${String(day).padStart(2, "0")}`;
          const posts = calData[dateStr] || [];
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDay;

          return (
            <button
              key={day}
              onClick={() => setSelectedDay(isSelected ? null : dateStr)}
              className={`min-h-[90px] flex flex-col p-1 text-left transition-all relative ${
                isSelected
                  ? "bg-cc-accent/10 ring-1 ring-inset ring-cc-accent/40"
                  : "bg-cc-card hover:bg-cc-hover/50"
              }`}
            >
              {/* Day number */}
              <span className={`text-[10px] leading-none mb-1 self-end px-1 py-0.5 rounded ${
                isToday
                  ? "bg-cc-accent text-white font-bold"
                  : "text-cc-muted"
              }`}>
                {day}
              </span>

              {/* Post previews (max 3 visible, then "+N more") */}
              <div className="flex flex-col gap-0.5 flex-1 w-full overflow-hidden">
                {posts.slice(0, 3).map((p) => (
                  <div
                    key={p.id}
                    className={`rounded px-1 py-0.5 text-[8px] leading-tight truncate border-l-2 ${
                      statusBorder[p.status] || "border-l-cc-muted"
                    } bg-cc-bg/80`}
                    title={p.text}
                  >
                    <span className="text-cc-muted mr-0.5">
                      {p.platforms.map((pl) => PLATFORM_ICONS[pl] || pl.charAt(0)).join("")}
                    </span>
                    <span className="text-cc-fg">{p.text.slice(0, 30)}{p.text.length > 30 ? "..." : ""}</span>
                  </div>
                ))}
                {posts.length > 3 && (
                  <span className="text-[8px] text-cc-muted text-center">+{posts.length - 3} more</span>
                )}
              </div>
            </button>
          );
        })}
        {/* Trailing empty cells to fill last row */}
        {(() => {
          const totalCells = startDow + daysInMonth;
          const remainder = totalCells % 7;
          if (remainder === 0) return null;
          return Array.from({ length: 7 - remainder }).map((_, i) => (
            <div key={`t-${i}`} className="min-h-[90px] bg-cc-bg/50" />
          ));
        })()}
      </div>

      {/* Day Detail Panel — opens below when a day is selected */}
      {selectedDay && (
        <div className="border border-cc-border rounded-xl overflow-hidden bg-cc-card">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-cc-border/50 bg-cc-bg/50">
            <h3 className="text-xs font-semibold text-cc-fg">
              {new Date(selectedDay + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-cc-muted">{dayPosts.length} post(s)</span>
              <button
                onClick={() => onEdit({ id: "", text: "", status: "draft", platforms: [], createdAt: "", scheduledAt: selectedDay + "T12:00:00" } as SocialPost)}
                className="text-[10px] px-2 py-1 rounded-md bg-cc-accent/10 text-cc-accent border border-cc-accent/30 hover:bg-cc-accent/20 transition-colors cursor-pointer"
              >
                + New Post
              </button>
              <button onClick={() => setSelectedDay(null)} className="text-cc-muted hover:text-cc-fg text-sm leading-none">&times;</button>
            </div>
          </div>

          {/* Posts list */}
          <div className="p-3 space-y-2">
            {dayPosts.length === 0 ? (
              <p className="text-[11px] text-cc-muted py-4 text-center">No posts on this day. Click "+ New Post" to create one.</p>
            ) : (
              dayPosts.map((p) => (
                <div key={p.id} className={`border rounded-lg overflow-hidden bg-cc-bg/50 border-cc-border/30`}>
                  <div className="flex gap-3 p-3">
                    {/* Thumbnail */}
                    {(p.mediaUrls?.length ?? 0) > 0 && (
                      <img
                        src={p.mediaUrls![0]}
                        alt=""
                        className="w-16 h-16 rounded-lg object-cover border border-cc-border/30 flex-shrink-0"
                      />
                    )}
                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {p.title && <div className="text-[11px] font-semibold text-cc-fg">{p.title}</div>}
                      <p className="text-[11px] text-cc-fg break-words leading-relaxed line-clamp-3">{p.text}</p>
                      {/* Badges row */}
                      <div className="flex flex-wrap gap-1 items-center">
                        <StatusBadge status={p.status} />
                        {p.createdBy && <CreatedByBadge by={p.createdBy} />}
                        {p.platforms.map((pl) => <PlatformBadge key={pl} platform={pl} />)}
                        {(p.scheduledAt || p.createdAt) && (
                          <span className="text-[9px] text-cc-muted ml-auto">
                            {new Date(p.scheduledAt || p.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1 px-3 py-1.5 border-t border-cc-border/20 bg-cc-bg/30">
                    <button onClick={() => onEdit(p)} className="text-[10px] px-2 py-0.5 text-cc-muted hover:text-cc-fg hover:bg-cc-hover rounded transition-colors">Edit</button>
                    <button onClick={() => handleReschedule(p.id)} className="text-[10px] px-2 py-0.5 text-cc-accent hover:bg-cc-accent/10 rounded transition-colors">Reschedule</button>
                    <button onClick={() => handleDeletePost(p.id)} className="text-[10px] px-2 py-0.5 text-red-400 hover:bg-red-400/10 rounded transition-colors ml-auto">Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Analytics Tab ──────────────────────────────────────────────────────────

function AnalyticsTab({ showMessage }: { showMessage: (text: string, isError?: boolean) => void }) {
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [accountMetrics, setAccountMetrics] = useState<{ followers: number; following: number; posts: number } | null>(null);
  const [postAnalytics, setPostAnalytics] = useState<Array<{ post: SocialPost; analytics: { impressions: number; likes: number; shares: number; comments: number } }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getSocialProfiles().then((d) => setProfiles(d.profiles || [])).catch(() => {});
  }, []);

  async function loadAnalytics() {
    if (!selectedProfile) { showMessage("Select a profile.", true); return; }
    setLoading(true);
    try {
      const acc = await api.getSocialAccountAnalytics(selectedProfile);
      setAccountMetrics(acc);

      const postsData = await api.listSocialPosts({ limit: 10 });
      const results = await Promise.all(
        (postsData.posts || [])
          .map(normalizePost)
          .filter((p: SocialPost) => p.status === "published")
          .map(async (p: SocialPost) => {
          try {
            const a = await api.getSocialPostAnalytics(p.id);
            return { post: p, analytics: a };
          } catch {
            return { post: p, analytics: { impressions: 0, likes: 0, shares: 0, comments: 0 } };
          }
        })
      );
      setPostAnalytics(results);
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Profile</label>
          <select
            value={selectedProfile}
            onChange={(e) => setSelectedProfile(e.target.value)}
            className="w-full bg-cc-bg border border-cc-border rounded-md p-2 text-xs text-cc-fg focus:outline-none"
          >
            <option value="">Select profile...</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{PLATFORM_ICONS[p.platform] || ""} {p.platform} — {p.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={loadAnalytics}
          disabled={loading}
          className="px-3 py-2 text-xs font-medium rounded-md bg-cc-accent/10 text-cc-accent border border-cc-accent/30 hover:bg-cc-accent/20 disabled:opacity-50 transition-colors"
        >
          {loading ? "Loading..." : "Load"}
        </button>
      </div>

      {accountMetrics && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Followers", value: accountMetrics.followers },
            { label: "Following", value: accountMetrics.following },
            { label: "Posts", value: accountMetrics.posts },
          ].map((m) => (
            <div key={m.label} className="border border-cc-border rounded-xl p-3.5 bg-cc-card text-center">
              <div className="text-xl font-bold text-cc-accent">{formatMetric(m.value)}</div>
              <div className="text-[9px] text-cc-muted uppercase tracking-wider mt-1">{m.label}</div>
            </div>
          ))}
        </div>
      )}

      {postAnalytics.length > 0 && (() => {
        const totals = postAnalytics.reduce((acc, { analytics }) => ({
          impressions: acc.impressions + analytics.impressions,
          likes: acc.likes + analytics.likes,
          shares: acc.shares + analytics.shares,
          comments: acc.comments + analytics.comments,
        }), { impressions: 0, likes: 0, shares: 0, comments: 0 });
        const engagementRate = totals.impressions > 0
          ? ((totals.likes + totals.shares + totals.comments) / totals.impressions * 100).toFixed(2)
          : "0.00";
        const topPost = postAnalytics.reduce((best, cur) => {
          const curScore = cur.analytics.likes + cur.analytics.shares + cur.analytics.comments;
          const bestScore = best.analytics.likes + best.analytics.shares + best.analytics.comments;
          return curScore > bestScore ? cur : best;
        }, postAnalytics[0]);

        return (
          <div className="space-y-3">
            {/* Summary */}
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: "Total Views", value: formatMetric(totals.impressions) },
                { label: "Total Likes", value: formatMetric(totals.likes) },
                { label: "Total Shares", value: formatMetric(totals.shares) },
                { label: "Total Comments", value: formatMetric(totals.comments) },
                { label: "Engagement", value: `${engagementRate}%` },
              ].map((m) => (
                <div key={m.label} className="border border-cc-border rounded-xl p-2.5 bg-cc-card text-center">
                  <div className="text-sm font-bold text-cc-accent">{m.value}</div>
                  <div className="text-[8px] text-cc-muted uppercase tracking-wider mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>

            {/* Top Performing Post */}
            {topPost && (topPost.analytics.likes + topPost.analytics.shares + topPost.analytics.comments) > 0 && (
              <div className="border border-cc-accent/30 rounded-xl p-3.5 bg-cc-accent/5 space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-accent/20 text-cc-accent font-medium">Top Post</span>
                </div>
                <p className="text-[11px] text-cc-fg break-words">{topPost.post.text.slice(0, 150)}{topPost.post.text.length > 150 ? "..." : ""}</p>
                <div className="flex gap-3 text-[10px] text-cc-muted">
                  <span>{formatMetric(topPost.analytics.impressions)} views</span>
                  <span>{formatMetric(topPost.analytics.likes)} likes</span>
                  <span>{formatMetric(topPost.analytics.shares)} shares</span>
                </div>
              </div>
            )}

            <h3 className="text-[10px] text-cc-muted uppercase tracking-wider font-medium">Post Performance</h3>
            {postAnalytics.map(({ post, analytics }) => (
              <div key={post.id} className="border border-cc-border rounded-xl p-3.5 bg-cc-card space-y-2">
                <p className="text-[11px] text-cc-fg break-words">{post.text.slice(0, 120)}{post.text.length > 120 ? "..." : ""}</p>
                <div className="flex gap-1 text-[10px]">
                  {post.platforms.map((p) => <PlatformBadge key={p} platform={p} />)}
                  <span className="text-cc-muted">{post.createdAt ? relativeTime(post.createdAt) : ""}</span>
                  {analytics.impressions > 0 && (
                    <span className="text-cc-muted ml-auto">
                      {((analytics.likes + analytics.shares + analytics.comments) / analytics.impressions * 100).toFixed(1)}% eng.
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: "Views", value: analytics.impressions },
                    { label: "Likes", value: analytics.likes },
                    { label: "Shares", value: analytics.shares },
                    { label: "Comments", value: analytics.comments },
                  ].map((m) => (
                    <div key={m.label} className="border border-cc-border/30 rounded-lg p-2 bg-cc-bg text-center">
                      <div className="text-sm font-bold text-cc-fg">{formatMetric(m.value)}</div>
                      <div className="text-[8px] text-cc-muted uppercase tracking-wider">{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Settings Tab ───────────────────────────────────────────────────────────

function SettingsTab({ showMessage, onSwitchTab }: { showMessage: (text: string, isError?: boolean) => void; onSwitchTab?: (tab: TabId) => void }) {
  const [backend, setBackend] = useState("");
  const [postizMode, setPostizMode] = useState<"hosted" | "selfhosted">("hosted");
  const [postizUrl, setPostizUrl] = useState("");
  const [postizKey, setPostizKey] = useState("");
  const [bufferKey, setBufferKey] = useState("");
  const [savedBackend, setSavedBackend] = useState("");
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false);
  // Browser-backed platform toggles (X/TikTok posted via persistent Playwright
  // instead of Postiz). Persisted as settings.browserPlatforms on the backend.
  const [browserPlatforms, setBrowserPlatforms] = useState<string[]>([]);
  const [browserStatus, setBrowserStatus] = useState<Array<{ platform: string; running: boolean; loggedIn: boolean | null; hasProfile: boolean }>>([]);

  const loadBrowserStatus = useCallback(async () => {
    try {
      const res = await api.getSocialBrowserStatus();
      setBrowserStatus(res.platforms);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    api.getSocialSettings().then((s: any) => {
      setBackend(s.backend || "");
      setSavedBackend(s.backend || "");
      if (s.backends?.postiz) {
        const url = s.backends.postiz.url || "";
        setPostizUrl(url);
        setPostizKey(s.backends.postiz.apiKey || "");
        setPostizMode(url && url !== "https://api.postiz.com" ? "selfhosted" : "hosted");
      }
      if (s.backends?.buffer) setBufferKey(s.backends.buffer.apiKey || "");
      if (s.requireApproval) setRequireApproval(true);
      if (Array.isArray(s.browserPlatforms)) setBrowserPlatforms(s.browserPlatforms);
    }).catch(() => {});
    loadBrowserStatus();
  }, [loadBrowserStatus]);

  function toggleBrowserPlatform(platform: string) {
    setBrowserPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    );
  }

  async function openBrowserFor(platform: string) {
    try {
      // Start the platform browser, then navigate the user to the SocialView tab
      // where the noVNC iframe lives — they can log in there.
      const res = await fetch(`/api/socialview/${platform}/start`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (onSwitchTab) onSwitchTab("view");
      showMessage(`Opened ${platform} browser — sign in via the noVNC viewer.`);
      loadBrowserStatus();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to open browser", true);
    }
  }

  async function saveSettings() {
    const backends: Record<string, unknown> = {};
    if (backend === "postiz") backends.postiz = { url: postizMode === "selfhosted" ? postizUrl : "", apiKey: postizKey };
    if (backend === "buffer") backends.buffer = { apiKey: bufferKey };
    await api.updateSocialSettings({
      backend: backend || null,
      backends,
      defaultPlatforms: [],
      requireApproval,
      browserPlatforms,
    });
    setSavedBackend(backend);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveSettings();
      showMessage("Settings saved.");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    try {
      await saveSettings();
      const result = await api.testSocialConnection();
      if (result.ok) {
        showMessage("Connection successful!");
        const data = await api.getSocialProfiles();
        setProfiles(data.profiles || []);
      } else {
        showMessage("Connection failed: " + (result.error || "unknown"), true);
      }
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    } finally {
      setTesting(false);
    }
  }

  const backendOptions = [
    { id: "buffer", label: "Buffer", desc: "SaaS — GraphQL API" },
    { id: "postiz", label: "Postiz", desc: "Hosted or Self-hosted" },
  ];

  return (
    <div className="space-y-5">
      {/* Backend Selection */}
      <div>
        <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Backend</label>
        <p className="text-[9px] text-cc-muted mb-2">One active backend at a time. Switching will replace the current configuration.</p>
        <div className="grid grid-cols-3 gap-2">
          {backendOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setBackend(opt.id)}
              className={`p-3 rounded-xl border text-left transition-all ${
                backend === opt.id
                  ? "border-cc-accent bg-cc-accent/10"
                  : "border-cc-border bg-cc-card hover:border-cc-accent/30"
              }`}
            >
              <div className="text-xs font-medium text-cc-fg flex items-center gap-1.5">
                {opt.label}
                {savedBackend === opt.id && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">Active</span>}
              </div>
              <div className="text-[9px] text-cc-muted mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Backend-specific fields */}
      {backend === "postiz" && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1.5">Hosting</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPostizMode("hosted")}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  postizMode === "hosted"
                    ? "border-cc-accent bg-cc-accent/10"
                    : "border-cc-border bg-cc-card hover:border-cc-accent/30"
                }`}
              >
                <div className="text-xs font-medium text-cc-fg">Standard</div>
                <div className="text-[9px] text-cc-muted mt-0.5">api.postiz.com</div>
              </button>
              <button
                onClick={() => setPostizMode("selfhosted")}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  postizMode === "selfhosted"
                    ? "border-cc-accent bg-cc-accent/10"
                    : "border-cc-border bg-cc-card hover:border-cc-accent/30"
                }`}
              >
                <div className="text-xs font-medium text-cc-fg">Self-hosted</div>
                <div className="text-[9px] text-cc-muted mt-0.5">Custom URL</div>
              </button>
            </div>
          </div>
          {postizMode === "selfhosted" && (
            <InputField label="Postiz URL" value={postizUrl} onChange={setPostizUrl} placeholder="https://postiz.example.com" />
          )}
          <InputField label="API Key" value={postizKey} onChange={setPostizKey} placeholder="Settings → Developers → Public API" password />
        </div>
      )}
      {backend === "buffer" && (
        <InputField label="Buffer API Key" value={bufferKey} onChange={setBufferKey} placeholder="Access Token from publish.buffer.com/settings/api" password />
      )}

      {/* Actions */}
      {backend && (
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 disabled:opacity-50 transition-colors">
            {saving ? "Saving..." : "Save"}
          </button>
          <button onClick={handleTestConnection} disabled={testing} className="px-4 py-2 text-xs font-medium rounded-md text-cc-muted hover:text-cc-fg border border-cc-border hover:border-cc-accent/30 disabled:opacity-50 transition-colors">
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </div>
      )}

      {/* Connected Profiles */}
      {profiles.length > 0 && (
        <div>
          <h3 className="text-[10px] text-cc-muted uppercase tracking-wider font-medium mb-2">Connected Channels</h3>
          <div className="grid grid-cols-2 gap-2">
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-cc-border/50 bg-cc-card">
                {p.picture ? (
                  <img src={p.picture} alt="" className="w-7 h-7 rounded-full" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-cc-accent/10 flex items-center justify-center text-[10px] text-cc-accent font-medium">
                    {PLATFORM_ICONS[p.platform] || "?"}
                  </div>
                )}
                <div>
                  <div className="text-[11px] font-medium text-cc-fg">{p.name}</div>
                  <div className="text-[9px] text-cc-muted">{p.platform}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approval Toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-cc-bg border border-cc-border">
        <div>
          <div className="text-xs font-medium text-cc-fg">Require Approval</div>
          <div className="text-[9px] text-cc-muted mt-0.5">Voice assistant must get manual approval before publishing</div>
        </div>
        <button
          onClick={() => setRequireApproval(!requireApproval)}
          className={`w-10 h-5 rounded-full transition-colors relative ${requireApproval ? "bg-cc-accent" : "bg-cc-border"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${requireApproval ? "left-5" : "left-0.5"}`} />
        </button>
      </div>

      {/* Browser Posting (X / TikTok) ─────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-cc-muted uppercase tracking-wider">Browser Posting</label>
          <button
            onClick={loadBrowserStatus}
            className="text-[9px] text-cc-muted hover:text-cc-fg"
          >
            Refresh status
          </button>
        </div>
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-[10px] text-yellow-200/90">
          <strong>Account-Risiko:</strong> X und TikTok verbieten Automation formell in den ToS.
          Nutze diese Option nur für eigene Accounts. Die Sessions bleiben lokal in{" "}
          <code className="text-[9px]">~/.heyhank/browser-profiles/&lt;platform&gt;/</code> persistent.
        </div>

        {(["twitter", "tiktok"] as const).map((platform) => {
          const enabled = browserPlatforms.includes(platform);
          const status = browserStatus.find((s) => s.platform === platform);
          const label = platform === "twitter" ? "X (Twitter)" : "TikTok";
          return (
            <div key={platform} className="rounded-lg border border-cc-border bg-cc-card p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs font-medium text-cc-fg">{label} über Browser posten</div>
                  <div className="text-[9px] text-cc-muted mt-0.5">
                    Statt {savedBackend || "Postiz"} wird eine persistente Playwright-Session genutzt.
                  </div>
                </div>
                <button
                  onClick={() => toggleBrowserPlatform(platform)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${enabled ? "bg-cc-accent" : "bg-cc-border"}`}
                  aria-label={`Toggle browser posting for ${label}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? "left-5" : "left-0.5"}`} />
                </button>
              </div>
              {enabled && (
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-cc-border/50">
                  <div className="text-[10px] text-cc-muted">
                    {status?.running ? (
                      <>
                        <span className="text-green-400">●</span> Running
                        {status.loggedIn === true && <span className="ml-2 text-green-400">· logged in</span>}
                        {status.loggedIn === false && <span className="ml-2 text-yellow-400">· not logged in</span>}
                      </>
                    ) : (
                      <>
                        <span className="text-cc-muted">○</span> Not running
                        {status?.hasProfile && <span className="ml-2">· profile exists</span>}
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => openBrowserFor(platform)}
                    className="text-[10px] px-2.5 py-1 rounded-md border border-cc-border hover:border-cc-accent/50 text-cc-fg"
                  >
                    Browser öffnen
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Hashtag Pools */}
      <HashtagPoolsSection showMessage={showMessage} />
    </div>
  );
}

// ─── Hashtag Pools UI ────────────────────────────────────────────────────────

interface HashtagPool {
  id: string;
  name: string;
  industry: string;
  language: string;
  popular: string[];
  medium: string[];
  niche: string[];
  branded: string[];
  blocked: string[];
  createdAt: string;
  updatedAt: string;
}

const TIER_META: Array<{ key: keyof Pick<HashtagPool, "popular" | "medium" | "niche" | "branded" | "blocked">; label: string; desc: string; color: string }> = [
  { key: "popular", label: "Popular", desc: ">1M posts, high reach", color: "text-green-400" },
  { key: "medium", label: "Medium", desc: "100K-1M posts, balanced", color: "text-blue-400" },
  { key: "niche", label: "Niche", desc: "<100K posts, targeted", color: "text-purple-400" },
  { key: "branded", label: "Branded", desc: "Your own brand hashtags", color: "text-cc-accent" },
  { key: "blocked", label: "Blocked", desc: "Never use these", color: "text-red-400" },
];

function HashtagPoolsSection({ showMessage }: { showMessage: (text: string, isError?: boolean) => void }) {
  const [pools, setPools] = useState<HashtagPool[]>([]);
  const [editingPool, setEditingPool] = useState<HashtagPool | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPools = useCallback(async () => {
    try {
      const data = await api.listHashtagPools();
      setPools(data.pools || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { loadPools(); }, [loadPools]);

  function startNew() {
    setEditingPool({
      id: "",
      name: "",
      industry: "",
      language: "de",
      popular: [],
      medium: [],
      niche: [],
      branded: [],
      blocked: [],
      createdAt: "",
      updatedAt: "",
    });
    setIsNew(true);
  }

  function startEdit(pool: HashtagPool) {
    setEditingPool({ ...pool });
    setIsNew(false);
  }

  async function handleSave() {
    if (!editingPool || !editingPool.name.trim()) {
      showMessage("Name is required", true);
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        await api.createHashtagPool(editingPool);
      } else {
        await api.updateHashtagPool(editingPool.id, editingPool as unknown as Record<string, unknown>);
      }
      showMessage("Hashtag pool saved.");
      setEditingPool(null);
      await loadPools();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to save", true);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(pool: HashtagPool) {
    if (!confirm(`Delete hashtag pool "${pool.name}"?`)) return;
    try {
      await api.deleteHashtagPool(pool.id);
      showMessage("Pool deleted.");
      await loadPools();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", true);
    }
  }

  function updateTier(tier: keyof Pick<HashtagPool, "popular" | "medium" | "niche" | "branded" | "blocked">, value: string) {
    if (!editingPool) return;
    const tags = value
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));
    setEditingPool({ ...editingPool, [tier]: tags });
  }

  // ─── Editor View ─────────────────────────────────────────────────
  if (editingPool) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] text-cc-muted uppercase tracking-wider font-medium">
            {isNew ? "New Hashtag Pool" : "Edit Hashtag Pool"}
          </h3>
          <button onClick={() => setEditingPool(null)} className="text-[10px] text-cc-muted hover:text-cc-fg">
            Cancel
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InputField label="Business / Brand Name" value={editingPool.name} onChange={(v) => setEditingPool({ ...editingPool, name: v })} placeholder="e.g. Ferienhaus Steiermark" />
          <InputField label="Industry" value={editingPool.industry} onChange={(v) => setEditingPool({ ...editingPool, industry: v })} placeholder="e.g. tourism, saas, fashion" />
        </div>

        <div>
          <label className="text-[10px] text-cc-muted block mb-1">Language</label>
          <select
            value={editingPool.language}
            onChange={(e) => setEditingPool({ ...editingPool, language: e.target.value })}
            className="bg-cc-bg border border-cc-border rounded-md p-2 text-xs text-cc-fg focus:outline-none focus:border-cc-accent/50"
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
            <option value="fr">French</option>
            <option value="es">Spanish</option>
            <option value="it">Italian</option>
          </select>
        </div>

        {TIER_META.map(({ key, label, desc, color }) => (
          <div key={key}>
            <label className="text-[10px] text-cc-muted block mb-1">
              <span className={color}>{label}</span>
              <span className="ml-1.5 text-cc-muted/60">{desc}</span>
            </label>
            <textarea
              value={editingPool[key].join(", ")}
              onChange={(e) => updateTier(key, e.target.value)}
              placeholder={`#tag1, #tag2, #tag3`}
              rows={2}
              className="w-full bg-cc-bg border border-cc-border rounded-md p-2 text-xs text-cc-fg focus:outline-none focus:border-cc-accent/50 resize-none"
            />
            <div className="text-[9px] text-cc-muted/50 mt-0.5">{editingPool[key].length} hashtags</div>
          </div>
        ))}

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : isNew ? "Create Pool" : "Save Changes"}
        </button>
      </div>
    );
  }

  // ─── List View ───────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-[10px] text-cc-muted uppercase tracking-wider font-medium">Hashtag Pools</h3>
          <p className="text-[9px] text-cc-muted mt-0.5">Curated hashtag sets per business. The Content Agent picks from these automatically.</p>
        </div>
        <button
          onClick={startNew}
          className="px-3 py-1.5 text-[10px] font-medium rounded-md bg-cc-accent/10 text-cc-accent hover:bg-cc-accent/20 border border-cc-accent/20 transition-colors"
        >
          + New Pool
        </button>
      </div>

      {pools.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-cc-border rounded-lg">
          <p className="text-xs text-cc-muted mb-1">No hashtag pools yet</p>
          <p className="text-[9px] text-cc-muted/60">Create a pool to give the Content Agent curated hashtags for your businesses.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pools.map((pool) => {
            const totalTags = pool.popular.length + pool.medium.length + pool.niche.length + pool.branded.length;
            return (
              <div key={pool.id} className="p-3 rounded-lg border border-cc-border bg-cc-card">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-medium text-cc-fg">{pool.name}</div>
                    <div className="text-[9px] text-cc-muted mt-0.5">
                      {pool.industry && <span>{pool.industry} · </span>}
                      {totalTags} hashtags
                      {pool.blocked.length > 0 && <span> · {pool.blocked.length} blocked</span>}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => startEdit(pool)} className="text-[10px] text-cc-muted hover:text-cc-accent transition-colors">Edit</button>
                    <button onClick={() => handleDelete(pool)} className="text-[10px] text-cc-muted hover:text-red-400 transition-colors">Delete</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {pool.popular.slice(0, 3).map((t) => (
                    <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">{t}</span>
                  ))}
                  {pool.medium.slice(0, 3).map((t) => (
                    <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">{t}</span>
                  ))}
                  {pool.niche.slice(0, 2).map((t) => (
                    <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">{t}</span>
                  ))}
                  {pool.branded.slice(0, 2).map((t) => (
                    <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-cc-accent/10 text-cc-accent border border-cc-accent/20">{t}</span>
                  ))}
                  {totalTags > 10 && (
                    <span className="text-[9px] px-1.5 py-0.5 text-cc-muted">+{totalTags - 10} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Shared Components ──────────────────────────────────────────────────────

function InputField({ label, value, onChange, placeholder, password }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; password?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] text-cc-muted block mb-1">{label}</label>
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-cc-bg border border-cc-border rounded-md p-2 text-xs text-cc-fg focus:outline-none focus:border-cc-accent/50"
      />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-12">
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-8 h-8 text-cc-muted/20 mx-auto mb-3">
        <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.5 5.3l-1 4.5a.75.75 0 01-.37.47.73.73 0 01-.58.05L7.7 9.58l-1.22 1.18a.25.25 0 01-.43-.17V9.13L10.5 5l-4.4 3.56-1.7-.56a.5.5 0 01-.02-.94l8.5-3.5a.5.5 0 01.62.74z" />
      </svg>
      <p className="text-xs text-cc-muted">{text}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    published: "text-green-400 border-green-400/30 bg-green-400/5",
    scheduled: "text-cc-accent border-cc-accent/30 bg-cc-accent/5",
    failed: "text-red-400 border-red-400/30 bg-red-400/5",
    draft: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
    partial: "text-orange-400 border-orange-400/30 bg-orange-400/5",
    archived: "text-cc-muted border-cc-border/50 bg-cc-bg",
  };
  return (
    <span className={`inline-block text-[9px] font-medium uppercase tracking-wider border rounded-full px-1.5 py-0.5 ${styles[status] || styles.draft}`}>
      {status}
    </span>
  );
}

function CreatedByBadge({ by }: { by: string }) {
  const styles: Record<string, string> = {
    gemini: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    agent: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    user: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  const label = by === "gemini" ? "Voice" : by === "agent" ? "Agent" : "Manual";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${styles[by] || styles.user}`}>
      {label}
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-cc-accent/80 border border-cc-accent/20 bg-cc-accent/5 rounded-full px-1.5 py-0.5">
      <span className="text-[8px]">{PLATFORM_ICONS[platform] || ""}</span>
      {platform}
    </span>
  );
}

function MediaPickerModal({ open, onClose, onSelect }: {
  open: boolean;
  onClose: () => void;
  onSelect: (urls: string[]) => void;
}) {
  const [media, setMedia] = useState<Array<{ filename: string; path: string; type: string; createdAt: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected(new Set());
    api.listMedia().then((data: any) => {
      setMedia((data.files || data.media || []).filter((f: any) => !f.type || f.type.startsWith("image/")));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  function toggle(path: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-cc-card border border-cc-border rounded-xl w-full max-w-lg max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-cc-border">
          <h3 className="text-sm font-semibold text-cc-fg">Media Library</h3>
          <button onClick={onClose} className="text-cc-muted hover:text-cc-fg text-lg">&times;</button>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {loading ? (
            <p className="text-xs text-cc-muted text-center py-8">Loading...</p>
          ) : media.length === 0 ? (
            <p className="text-xs text-cc-muted text-center py-8">No images found. Generate images via Hank or upload files.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {media.map((m) => (
                <button key={m.filename} onClick={() => toggle(`/api/media/file/${m.filename}`)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    selected.has(`/api/media/file/${m.filename}`) ? "border-cc-accent ring-2 ring-cc-accent/30" : "border-transparent hover:border-cc-border"
                  }`}>
                  <img src={`/api/media/file/${m.filename}`} alt={m.filename} className="w-full h-full object-cover" />
                  {selected.has(`/api/media/file/${m.filename}`) && (
                    <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-cc-accent text-white flex items-center justify-center text-[10px] font-bold">&#10003;</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        {selected.size > 0 && (
          <div className="p-3 border-t border-cc-border flex justify-between items-center">
            <span className="text-xs text-cc-muted">{selected.size} selected</span>
            <button onClick={() => { onSelect(Array.from(selected)); onClose(); }}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 transition-colors">
              Attach Selected
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
