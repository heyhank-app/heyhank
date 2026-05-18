// ─── SocialLibraryTab ────────────────────────────────────────────────────────
// Reference library of extracted posts. User reviews, tags, marks gold, and
// only gold-marked posts feed the content agent as few-shot examples.
// Persona / style-profile management lives in the dedicated PersonasTab.

import { useEffect, useState, useCallback } from "react";

type Platform = "instagram" | "twitter" | "linkedin" | "facebook" | "tiktok";

interface LibraryPost {
  id: string;
  platform: Platform;
  source: "own" | "role-model";
  url: string;
  author: { handle: string; displayName?: string; followers?: number };
  text: string;
  hook: string;
  cta: string | null;
  hashtags: string[];
  mentions: string[];
  media: Array<{ type: "image" | "video"; remoteUrl: string | null; description: string }>;
  engagement: { likes: number | null; comments: number | null };
  engagementRate: number | null;
  postType: string;
  postedAt: string | null;
  tags: string[];
  isGold: boolean;
  extractedAt: string;
  notes: string;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("heyhank_auth_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

interface Props {
  showMessage: (text: string, isError?: boolean) => void;
}

type SortBy = "extracted" | "posted" | "engagement";
type TimeWindow = "all" | "1" | "7" | "30";

export function SocialLibraryTab({ showMessage }: Props): React.ReactElement {
  const [posts, setPosts] = useState<LibraryPost[]>([]);
  const [filterPlatform, setFilterPlatform] = useState<"all" | Platform>("all");
  const [filterSource, setFilterSource] = useState<"all" | "own" | "role-model">("all");
  const [goldOnly, setGoldOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("extracted");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [minLikes, setMinLikes] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterPlatform !== "all") qs.set("platform", filterPlatform);
      if (filterSource !== "all") qs.set("source", filterSource);
      if (goldOnly) qs.set("goldOnly", "true");
      if (sortBy !== "extracted") qs.set("sortBy", sortBy);
      if (timeWindow !== "all") qs.set("postedWithinDays", timeWindow);
      const minLikesNum = Number(minLikes);
      if (minLikes && Number.isFinite(minLikesNum) && minLikesNum > 0) {
        qs.set("minLikes", String(Math.floor(minLikesNum)));
      }
      const data = await apiGet<{ posts: LibraryPost[] }>(`/api/socialview/library?${qs}`);
      setPosts(data.posts);
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Failed to load library", true);
    } finally {
      setLoading(false);
    }
  }, [filterPlatform, filterSource, goldOnly, sortBy, timeWindow, minLikes, showMessage]);

  // "Latest Hits" preset — flips three filters at once for the typical
  // "show me what's hot from creators I follow in the last week" view.
  function applyLatestHitsPreset() {
    setFilterSource("role-model");
    setSortBy("posted");
    setTimeWindow("7");
    setGoldOnly(false);
  }

  useEffect(() => { refresh(); }, [refresh]);

  async function toggleGold(post: LibraryPost) {
    try {
      await apiPatch(`/api/socialview/library/${post.platform}/${post.id}`, { isGold: !post.isGold });
      showMessage(post.isGold ? "Removed gold mark" : "Marked as gold standard");
      await refresh();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Update failed", true);
    }
  }

  async function addTag(post: LibraryPost) {
    const raw = (tagInput[post.id] || "").trim();
    if (!raw) return;
    const newTags = Array.from(new Set([...post.tags, raw]));
    try {
      await apiPatch(`/api/socialview/library/${post.platform}/${post.id}`, { tags: newTags });
      setTagInput({ ...tagInput, [post.id]: "" });
      await refresh();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Tag failed", true);
    }
  }

  async function removeTag(post: LibraryPost, tag: string) {
    const newTags = post.tags.filter((t) => t !== tag);
    try {
      await apiPatch(`/api/socialview/library/${post.platform}/${post.id}`, { tags: newTags });
      await refresh();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Tag remove failed", true);
    }
  }

  async function deletePost(post: LibraryPost) {
    if (!confirm(`Delete this library post permanently?`)) return;
    try {
      await apiDelete(`/api/socialview/library/${post.platform}/${post.id}`);
      showMessage("Deleted");
      await refresh();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Delete failed", true);
    }
  }

  return (
    <div className="space-y-3">
      {/* Latest Hits preset — one click for the "what's hot from creators I follow last week" view */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={applyLatestHitsPreset}
          className="text-xs px-3 py-1 rounded-md bg-cc-accent/10 border border-cc-accent/30 text-cc-accent hover:bg-cc-accent/20"
          title="Show role-model posts from the last 7 days, sorted by publish date"
        >
          ★ Latest Hits
        </button>
        <span className="text-[11px] text-cc-muted">
          source=role-model · sortBy=posted · last 7 days
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={filterPlatform}
          onChange={(e) => setFilterPlatform(e.target.value as typeof filterPlatform)}
          className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg"
          aria-label="Filter by platform"
        >
          <option value="all">All platforms</option>
          <option value="instagram">Instagram</option>
          <option value="twitter">X (Twitter)</option>
          <option value="linkedin">LinkedIn</option>
          <option value="facebook">Facebook</option>
          <option value="tiktok">TikTok</option>
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value as typeof filterSource)}
          className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg"
          aria-label="Filter by source"
        >
          <option value="all">All sources</option>
          <option value="own">Own</option>
          <option value="role-model">Role Model</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg"
          aria-label="Sort by"
        >
          <option value="extracted">Newest extracted</option>
          <option value="posted">Newest posted</option>
          <option value="engagement">Highest engagement</option>
        </select>
        <select
          value={timeWindow}
          onChange={(e) => setTimeWindow(e.target.value as TimeWindow)}
          className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg"
          aria-label="Posted within"
        >
          <option value="all">All time</option>
          <option value="1">Last 24h</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-cc-fg" title="Hide posts below this like count">
          Min likes
          <input
            type="number"
            min="0"
            value={minLikes}
            onChange={(e) => setMinLikes(e.target.value)}
            placeholder="0"
            className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg w-16"
            aria-label="Minimum likes"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-cc-fg">
          <input
            type="checkbox"
            checked={goldOnly}
            onChange={(e) => setGoldOnly(e.target.checked)}
          />
          Gold only
        </label>
        <button
          onClick={refresh}
          className="text-xs px-2 py-1 rounded-md bg-cc-surface border border-cc-border text-cc-fg hover:bg-cc-bg"
        >
          Refresh
        </button>
        <span className="text-xs text-cc-muted ml-auto">{posts.length} posts</span>
      </div>

      {loading && <div className="text-xs text-cc-muted">Loading…</div>}
      {!loading && posts.length === 0 && (
        <div className="text-xs text-cc-muted border border-dashed border-cc-border rounded-md p-6 text-center">
          No posts yet. Use the View tab to open a platform, navigate to a post or profile, and
          click "Extract this page → Library".
        </div>
      )}

      {/* Posts */}
      <div className="space-y-2">
        {posts.map((post) => {
          const expanded = expandedId === post.id;
          return (
            <div
              key={post.id}
              className={`border rounded-md p-3 transition-colors ${
                post.isGold ? "border-yellow-500/40 bg-yellow-500/5" : "border-cc-border bg-cc-surface"
              }`}
            >
              <div className="flex items-start gap-3">
                {post.media[0]?.remoteUrl && (
                  <img
                    src={post.media[0].remoteUrl}
                    alt=""
                    className="w-16 h-16 object-cover rounded shrink-0 bg-cc-bg"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-bg text-cc-muted uppercase">
                      {post.platform}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-bg text-cc-muted">
                      {post.source}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-bg text-cc-muted">
                      {post.postType}
                    </span>
                    {post.author.handle && (
                      <span className="text-xs font-medium text-cc-fg">@{post.author.handle}</span>
                    )}
                    {post.isGold && <span className="text-[10px] text-yellow-400">★ gold</span>}
                  </div>
                  <div className="text-xs text-cc-fg line-clamp-2">
                    {post.hook || post.text.slice(0, 140)}
                  </div>
                  {post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {post.tags.map((t) => (
                        <button
                          key={t}
                          onClick={() => removeTag(post, t)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-cc-accent/10 text-cc-accent hover:bg-red-500/20 hover:text-red-400"
                          title="Click to remove"
                        >
                          {t} ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => toggleGold(post)}
                    className={`text-xs px-2 py-1 rounded border ${
                      post.isGold
                        ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-400"
                        : "bg-cc-bg border-cc-border text-cc-muted hover:text-yellow-400"
                    }`}
                    title="Mark as gold standard — only gold posts are used as few-shot for the agent"
                  >
                    {post.isGold ? "★" : "☆"}
                  </button>
                  <button
                    onClick={() => setExpandedId(expanded ? null : post.id)}
                    className="text-xs px-2 py-1 rounded bg-cc-bg border border-cc-border text-cc-fg hover:bg-cc-surface"
                  >
                    {expanded ? "Hide" : "Open"}
                  </button>
                  <button
                    onClick={() => deletePost(post)}
                    className="text-xs px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
                  >
                    Del
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="mt-3 space-y-2 text-xs border-t border-cc-border pt-3">
                  {post.url && (
                    <a href={post.url} target="_blank" rel="noopener noreferrer" className="text-cc-accent hover:underline break-all">
                      {post.url}
                    </a>
                  )}
                  <div className="whitespace-pre-wrap text-cc-fg">{post.text}</div>
                  {post.cta && (
                    <div>
                      <span className="text-cc-muted">CTA: </span>
                      <span className="text-cc-fg">{post.cta}</span>
                    </div>
                  )}
                  {post.media[0]?.description && (
                    <div className="bg-cc-bg border border-cc-border rounded p-2">
                      <div className="text-cc-muted text-[10px] mb-1">Visual analysis (Claude):</div>
                      <div className="text-cc-fg whitespace-pre-wrap">{post.media[0].description}</div>
                    </div>
                  )}
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={tagInput[post.id] || ""}
                      onChange={(e) => setTagInput({ ...tagInput, [post.id]: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") addTag(post); }}
                      placeholder="Add tag (e.g. B2B, personal-story, humor)"
                      className="flex-1 text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg"
                    />
                    <button
                      onClick={() => addTag(post)}
                      className="text-xs px-2 py-1 rounded-md bg-cc-accent text-white hover:bg-cc-accent/90"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

