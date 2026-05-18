// ─── SocialWatchListTab ──────────────────────────────────────────────────────
// CRUD UI for the creators we want the auto-crawler to track. The crawler
// (server-side cron) visits each enabled entry on its schedule and stores
// the extracted posts as role-model entries in the SocialLibrary.

import { useEffect, useState, useCallback } from "react";

type Platform = "instagram" | "twitter" | "linkedin" | "facebook" | "tiktok";

interface WatchListEntry {
  id: string;
  platform: Platform;
  handle: string;
  displayName?: string;
  notes?: string;
  enabled: boolean;
  createdAt: string;
  lastCrawledAt: string | null;
  lastCrawlStatus: "ok" | "error" | "never";
  lastCrawlMessage?: string;
  lastCrawlPostsExtracted?: number;
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

async function apiSend<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface Props {
  showMessage: (text: string, isError?: boolean) => void;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "soon";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function SocialWatchListTab({ showMessage }: Props): React.ReactElement {
  const [entries, setEntries] = useState<WatchListEntry[]>([]);
  const [filterPlatform, setFilterPlatform] = useState<"all" | Platform>("all");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [loading, setLoading] = useState(false);

  // Add-form state
  const [newPlatform, setNewPlatform] = useState<Platform>("instagram");
  const [newHandle, setNewHandle] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [crawlingEntryId, setCrawlingEntryId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterPlatform !== "all") qs.set("platform", filterPlatform);
      if (enabledOnly) qs.set("enabledOnly", "true");
      const data = await apiGet<{ entries: WatchListEntry[] }>(`/api/socialview/watch-list?${qs}`);
      setEntries(data.entries);
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Failed to load watch list", true);
    } finally {
      setLoading(false);
    }
  }, [filterPlatform, enabledOnly, showMessage]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newHandle.trim()) return;
    setAdding(true);
    try {
      await apiSend("/api/socialview/watch-list", "POST", {
        platform: newPlatform,
        handle: newHandle.trim(),
        displayName: newDisplayName.trim() || undefined,
        notes: newNotes.trim() || undefined,
      });
      setNewHandle("");
      setNewDisplayName("");
      setNewNotes("");
      showMessage(`Added ${newHandle.trim()} to ${newPlatform}`);
      await refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Add failed", true);
    } finally {
      setAdding(false);
    }
  }

  async function toggleEnabled(entry: WatchListEntry) {
    try {
      await apiSend(`/api/socialview/watch-list/${entry.id}`, "PATCH", { enabled: !entry.enabled });
      showMessage(entry.enabled ? "Paused" : "Resumed");
      await refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Toggle failed", true);
    }
  }

  async function handleCrawlAll() {
    setCrawling(true);
    try {
      const summary = await apiSend<{ succeeded: number; failed: number; skipped: number; postsExtracted: number; totalEntries: number }>(
        "/api/socialview/watch-list/crawl-now",
        "POST",
      );
      if (summary.totalEntries === 0) {
        showMessage("No enabled creators to crawl");
      } else {
        showMessage(
          `Crawled ${summary.succeeded}/${summary.totalEntries} • ${summary.postsExtracted} posts • ${summary.failed} failed • ${summary.skipped} skipped`,
        );
      }
      await refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Crawl failed", true);
    } finally {
      setCrawling(false);
    }
  }

  async function handleCrawlOne(entry: WatchListEntry) {
    setCrawlingEntryId(entry.id);
    try {
      const result = await apiSend<{ ok: boolean; postsExtracted: number; error?: string }>(
        `/api/socialview/watch-list/${entry.id}/crawl-now`,
        "POST",
      );
      if (result.ok) {
        showMessage(`Crawled ${entry.handle}: ${result.postsExtracted} posts`);
      } else {
        showMessage(`Crawl failed for ${entry.handle}: ${result.error || "unknown error"}`, true);
      }
      await refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Crawl failed", true);
    } finally {
      setCrawlingEntryId(null);
    }
  }

  async function handleDelete(entry: WatchListEntry) {
    if (!window.confirm(`Remove ${entry.handle} from watch list?`)) return;
    try {
      await apiSend(`/api/socialview/watch-list/${entry.id}`, "DELETE");
      showMessage(`Removed ${entry.handle}`);
      await refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Delete failed", true);
    }
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <form
        onSubmit={handleAdd}
        className="border border-cc-border rounded-md bg-cc-surface p-3 space-y-2"
        aria-label="Add creator to watch list"
      >
        <div className="text-xs font-medium text-cc-fg">Add creator</div>
        <div className="flex flex-wrap gap-2 items-start">
          <select
            value={newPlatform}
            onChange={(e) => setNewPlatform(e.target.value as Platform)}
            className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg"
            aria-label="Platform"
          >
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="twitter">X (Twitter)</option>
            <option value="linkedin">LinkedIn</option>
            <option value="facebook">Facebook</option>
          </select>
          <input
            type="text"
            value={newHandle}
            onChange={(e) => setNewHandle(e.target.value)}
            placeholder="handle (without @)"
            className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg flex-1 min-w-[160px]"
            aria-label="Handle"
            required
          />
          <input
            type="text"
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            placeholder="display name (optional)"
            className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg flex-1 min-w-[140px]"
            aria-label="Display name"
          />
          <button
            type="submit"
            disabled={adding || !newHandle.trim()}
            className="text-xs px-3 py-1 rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
        <input
          type="text"
          value={newNotes}
          onChange={(e) => setNewNotes(e.target.value)}
          placeholder="notes — why am I following this creator? (optional)"
          className="text-xs w-full px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg"
          aria-label="Notes"
        />
      </form>

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
          <option value="tiktok">TikTok</option>
          <option value="twitter">X (Twitter)</option>
          <option value="linkedin">LinkedIn</option>
          <option value="facebook">Facebook</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-cc-fg">
          <input
            type="checkbox"
            checked={enabledOnly}
            onChange={(e) => setEnabledOnly(e.target.checked)}
          />
          Enabled only
        </label>
        <button
          onClick={() => void refresh()}
          className="text-xs px-2 py-1 rounded-md bg-cc-surface border border-cc-border text-cc-fg hover:bg-cc-bg"
        >
          Refresh
        </button>
        <button
          onClick={() => void handleCrawlAll()}
          disabled={crawling}
          className="text-xs px-3 py-1 rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 disabled:opacity-50"
          title="Crawl every enabled creator now instead of waiting for the nightly cron"
        >
          {crawling ? "Crawling…" : "Crawl now"}
        </button>
        <span className="text-xs text-cc-muted ml-auto">{entries.length} creators</span>
      </div>

      {/* Empty + loading */}
      {loading && <div className="text-xs text-cc-muted">Loading…</div>}
      {!loading && entries.length === 0 && (
        <div className="text-xs text-cc-muted border border-dashed border-cc-border rounded-md p-6 text-center">
          No creators yet. Add a few above and the auto-crawler will start collecting their posts
          into the Library.
        </div>
      )}

      {/* List */}
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={`border rounded-md p-3 ${
              entry.enabled ? "border-cc-border bg-cc-surface" : "border-cc-border/40 bg-cc-surface/40 opacity-70"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-bg text-cc-muted uppercase">
                    {entry.platform}
                  </span>
                  <span className="text-sm font-medium text-cc-fg">
                    {entry.displayName || entry.handle}
                  </span>
                  {entry.displayName && (
                    <span className="text-xs text-cc-muted">@{entry.handle}</span>
                  )}
                  {!entry.enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-muted/20 text-cc-muted">
                      paused
                    </span>
                  )}
                </div>
                {entry.notes && (
                  <div className="text-xs text-cc-muted mb-1">{entry.notes}</div>
                )}
                <div className="text-[11px] text-cc-muted flex flex-wrap gap-x-3">
                  <span>
                    last crawl: <span className={
                      entry.lastCrawlStatus === "error"
                        ? "text-red-400"
                        : entry.lastCrawlStatus === "ok"
                        ? "text-green-400"
                        : "text-cc-muted"
                    }>{entry.lastCrawlStatus}</span> ({formatRelative(entry.lastCrawledAt)})
                  </span>
                  {typeof entry.lastCrawlPostsExtracted === "number" && (
                    <span>{entry.lastCrawlPostsExtracted} posts last run</span>
                  )}
                  {entry.lastCrawlMessage && entry.lastCrawlStatus === "error" && (
                    <span className="text-red-400" title={entry.lastCrawlMessage}>
                      {entry.lastCrawlMessage.slice(0, 60)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => void handleCrawlOne(entry)}
                  disabled={crawlingEntryId === entry.id || !entry.enabled}
                  className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg hover:bg-cc-surface disabled:opacity-40"
                  aria-label={`Crawl ${entry.handle} now`}
                  title={entry.enabled ? "Crawl this creator now" : "Resume the entry to enable crawling"}
                >
                  {crawlingEntryId === entry.id ? "…" : "Crawl"}
                </button>
                <button
                  onClick={() => void toggleEnabled(entry)}
                  className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg hover:bg-cc-surface"
                  aria-label={entry.enabled ? `Pause ${entry.handle}` : `Resume ${entry.handle}`}
                >
                  {entry.enabled ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={() => void handleDelete(entry)}
                  className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-red-500/30 text-red-400 hover:bg-red-500/10"
                  aria-label={`Remove ${entry.handle}`}
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
