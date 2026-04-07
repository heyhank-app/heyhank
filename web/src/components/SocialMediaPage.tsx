import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api.js";

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

type TabId = "posts" | "drafts" | "calendar" | "analytics" | "settings";
type PostFilter = "all" | "published" | "scheduled" | "failed";

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
  const [activeTab, setActiveTab] = useState<TabId>("posts");
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
    { id: "analytics", label: "Analytics" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className={`h-full overflow-auto ${embedded ? "" : "p-4"}`}>
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
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
        {activeTab === "analytics" && <AnalyticsTab showMessage={showMessage} />}
        {activeTab === "settings" && <SettingsTab showMessage={showMessage} />}
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

  const isEditing = !!post;
  const charCount = text.length;
  const twitterLimit = 280;

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
        onSuccess("Post updated!");
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
          {platforms.includes("twitter") && (
            <div className={`absolute bottom-2 right-2 text-[10px] ${charCount > twitterLimit ? "text-red-400" : "text-cc-muted"}`}>
              {charCount}/{twitterLimit}
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

  const loadPosts = useCallback(async () => {
    try {
      const data = await api.listSocialPosts({ limit: 50 });
      setPosts((data.posts || []).filter((p: SocialPost) => p.status !== "draft"));
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

  const filtered = posts.filter((p) => {
    if (filter !== "all" && p.status !== filter) return false;
    if (platformFilter && !p.platforms.includes(platformFilter)) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1">
          {(["all", "published", "scheduled", "failed"] as PostFilter[]).map((f) => (
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
        <span className="text-[10px] text-cc-muted ml-auto">{filtered.length} post(s)</span>
      </div>

      {/* Post List */}
      {filtered.length === 0 ? (
        <EmptyState text={filter === "all" ? "No posts yet. Create your first post!" : `No ${filter} posts.`} />
      ) : (
        <div className="space-y-2">
          {filtered.map((post) => (
            <PostCard key={post.id} post={post} onEdit={onEdit} onDelete={handleDelete} showMessage={showMessage} onRefresh={() => { loadPosts(); onRefresh(); }} />
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

  const loadDrafts = useCallback(async () => {
    try {
      const data = await api.listSocialPosts({ limit: 50, status: "draft" });
      setDrafts(data.posts || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts, refreshKey]);

  async function handlePublish(id: string) {
    setPublishing(id);
    try {
      await api.publishSocialPost(id);
      showMessage("Post published!");
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
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-cc-muted">{drafts.length} draft(s)</span>
      </div>

      {drafts.length === 0 ? (
        <EmptyState text="No drafts. Drafts created by you, Gemini, or agents will appear here." />
      ) : (
        <div className="space-y-2">
          {drafts.map((draft) => (
            <PostCard
              key={draft.id}
              post={draft}
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

function PostCard({ post, onEdit, onDelete, showMessage, onRefresh, onPublish, isPublishing }: {
  post: SocialPost;
  onEdit: (post: SocialPost) => void;
  onDelete: (id: string) => void;
  showMessage: (text: string, isError?: boolean) => void;
  onRefresh: () => void;
  onPublish?: (id: string) => void;
  isPublishing?: boolean;
}) {
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<SocialComment[]>([]);
  const isDraft = post.status === "draft";
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
    <div className={`border rounded-xl overflow-hidden bg-cc-card transition-colors ${
      isDraft ? "border-yellow-500/25" : "border-cc-border/50"
    }`}>
      <div className="p-3.5 space-y-2.5">
        {/* Title */}
        {post.title && (
          <h3 className="text-xs font-semibold text-cc-fg">{post.title}</h3>
        )}

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
          {post.createdBy && post.createdBy !== "user" && <CreatedByBadge by={post.createdBy} />}
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
        <button
          onClick={() => onDelete(post.id)}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-red-400/70 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors ml-auto"
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
      setCalData(data.days || {});
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

  const dayPosts = selectedDay ? (calData[selectedDay] || []) : [];

  return (
    <div className="space-y-3">
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="px-2 py-1 text-cc-muted hover:text-cc-fg transition-colors rounded-md hover:bg-cc-hover">&larr;</button>
        <span className="text-sm font-medium text-cc-fg">{MONTH_NAMES[month]} {year}</span>
        <button onClick={nextMonth} className="px-2 py-1 text-cc-muted hover:text-cc-fg transition-colors rounded-md hover:bg-cc-hover">&rarr;</button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="text-center text-[9px] font-medium text-cc-muted py-1.5 uppercase tracking-wider">{d}</div>
        ))}
        {Array.from({ length: startDow }).map((_, i) => (
          <div key={`e-${i}`} className="aspect-square" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = `${monthStr}-${String(day).padStart(2, "0")}`;
          const posts = calData[dateStr] || [];
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDay;
          const hasDrafts = posts.some((p) => p.status === "draft");
          const hasScheduled = posts.some((p) => p.status === "scheduled");
          const hasPublished = posts.some((p) => p.status === "published");

          return (
            <button
              key={day}
              onClick={() => setSelectedDay(isSelected ? null : dateStr)}
              className={`aspect-square flex flex-col items-center justify-center rounded-lg text-xs transition-all border relative ${
                isSelected
                  ? "border-cc-accent bg-cc-accent/15 text-cc-accent font-semibold"
                  : posts.length > 0
                    ? "border-cc-border/30 bg-cc-card text-cc-fg hover:border-cc-accent/30"
                    : "border-transparent text-cc-fg hover:bg-cc-hover"
              } ${isToday ? "ring-1 ring-cc-accent/30" : ""}`}
            >
              <span className={isToday ? "font-bold" : ""}>{day}</span>
              {posts.length > 0 && (
                <div className="flex items-center gap-0.5 mt-0.5">
                  {hasPublished && <div className="w-1 h-1 rounded-full bg-green-400" />}
                  {hasScheduled && <div className="w-1 h-1 rounded-full bg-cc-accent" />}
                  {hasDrafts && <div className="w-1 h-1 rounded-full bg-yellow-400" />}
                  <span className="text-[8px] text-cc-muted font-medium ml-0.5">{posts.length}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-3 justify-center text-[9px] text-cc-muted">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> Published</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-cc-accent inline-block" /> Scheduled</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" /> Draft</span>
      </div>

      {/* Day Detail */}
      {selectedDay && (
        <div className="border border-cc-border rounded-xl p-3.5 bg-cc-card space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-cc-fg">
              {new Date(selectedDay + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </h3>
            <button
              onClick={() => onEdit({ id: "", text: "", status: "draft", platforms: [], createdAt: "", scheduledAt: selectedDay + "T12:00:00" } as SocialPost)}
              className="text-[10px] px-2 py-1 rounded-md bg-cc-accent/10 text-cc-accent border border-cc-accent/30 hover:bg-cc-accent/20 transition-colors cursor-pointer"
            >
              + New Post
            </button>
          </div>
          {dayPosts.length === 0 ? (
            <p className="text-[10px] text-cc-muted">No posts on this day.</p>
          ) : (
            dayPosts.map((p) => (
              <div key={p.id} className="border border-cc-border/30 rounded-lg p-2.5 space-y-1.5 bg-cc-bg/50">
                {p.title && <div className="text-[11px] font-semibold text-cc-fg">{p.title}</div>}
                <p className="text-[11px] text-cc-fg break-words leading-relaxed">{p.text}</p>
                <div className="flex flex-wrap gap-1 items-center">
                  <StatusBadge status={p.status} />
                  {p.platforms.map((pl) => <PlatformBadge key={pl} platform={pl} />)}
                  {p.scheduledAt && <span className="text-[9px] text-cc-muted">{new Date(p.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => onEdit(p)} className="text-[10px] text-cc-muted hover:text-cc-fg transition-colors">Edit</button>
                  <button onClick={() => handleReschedule(p.id)} className="text-[10px] text-cc-accent hover:text-cc-accent/80 transition-colors">Reschedule</button>
                </div>
              </div>
            ))
          )}
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
        (postsData.posts || []).filter((p: SocialPost) => p.status === "published").map(async (p: SocialPost) => {
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

function SettingsTab({ showMessage }: { showMessage: (text: string, isError?: boolean) => void }) {
  const [backend, setBackend] = useState("");
  const [postizMode, setPostizMode] = useState<"hosted" | "selfhosted">("hosted");
  const [postizUrl, setPostizUrl] = useState("");
  const [postizKey, setPostizKey] = useState("");
  const [ayrshareKey, setAyrshareKey] = useState("");
  const [bufferKey, setBufferKey] = useState("");
  const [savedBackend, setSavedBackend] = useState("");
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

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
      if (s.backends?.ayrshare) setAyrshareKey(s.backends.ayrshare.apiKey || "");
      if (s.backends?.buffer) setBufferKey(s.backends.buffer.apiKey || "");
    }).catch(() => {});
  }, []);

  async function saveSettings() {
    const backends: Record<string, unknown> = {};
    if (backend === "postiz") backends.postiz = { url: postizMode === "selfhosted" ? postizUrl : "", apiKey: postizKey };
    if (backend === "ayrshare") backends.ayrshare = { apiKey: ayrshareKey };
    if (backend === "buffer") backends.buffer = { apiKey: bufferKey };
    await api.updateSocialSettings({ backend: backend || null, backends, defaultPlatforms: [] });
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
    { id: "ayrshare", label: "Ayrshare", desc: "SaaS — REST API" },
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
      {backend === "ayrshare" && (
        <InputField label="Ayrshare API Key" value={ayrshareKey} onChange={setAyrshareKey} placeholder="API Key" password />
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
  };
  return (
    <span className={`inline-block text-[9px] font-medium uppercase tracking-wider border rounded-full px-1.5 py-0.5 ${styles[status] || styles.draft}`}>
      {status}
    </span>
  );
}

function CreatedByBadge({ by }: { by: string }) {
  const styles: Record<string, string> = {
    gemini: "text-blue-400 border-blue-400/30 bg-blue-400/5",
    agent: "text-purple-400 border-purple-400/30 bg-purple-400/5",
  };
  return (
    <span className={`inline-block text-[9px] font-medium border rounded-full px-1.5 py-0.5 ${styles[by] || "text-cc-muted border-cc-border"}`}>
      {by === "gemini" ? "✦ Gemini" : by === "agent" ? "⚡ Agent" : by}
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
