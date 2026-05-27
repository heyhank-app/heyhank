// ─── Auto-DM Tab ────────────────────────────────────────────────────────────
// Manages the keyword-triggered Auto-DM rules. Lists existing rules, lets the
// user create / edit / delete / toggle them. Backed by the REST endpoints in
// server/automation/automation-routes.ts. Shows a setup banner when the Meta
// secrets aren't configured yet.

import { useCallback, useEffect, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Platform = "instagram" | "facebook";

interface AutoDmRule {
  id: string;
  platform: Platform;
  postId: string | null;
  keyword: string;
  dmTemplate: string;
  enabled: boolean;
  sentCount: number;
  sentTo: Array<{ postId: string; commenterId: string; sentAt: string }>;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

interface MetaSecretsStatus {
  configured: boolean;
  appId: string;
  pageId: string;
  igBusinessId: string;
  appSecretConfigured: boolean;
  pageAccessTokenConfigured: boolean;
  webhookVerifyConfigured: boolean;
}

interface ConnectedPage {
  id: string;
  name: string;
  picture: string | null;
  isActive: boolean;
}

interface ConnectedPagesResponse {
  pages: ConnectedPage[];
  activePageId?: string;
  source?: "user-token" | "page-token-fallback";
  needsReconnect: boolean;
  reason?: string;
}

interface Props {
  showMessage: (text: string, isError?: boolean) => void;
}

// ─── REST helpers ────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function apiSend<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AutoDmTab({ showMessage }: Props) {
  const [rules, setRules] = useState<AutoDmRule[]>([]);
  const [secrets, setSecrets] = useState<MetaSecretsStatus | null>(null);
  const [pagesData, setPagesData] = useState<ConnectedPagesResponse | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState<AutoDmRule | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, secretsRes] = await Promise.all([
        apiGet<{ rules: AutoDmRule[] }>("/api/automation/rules"),
        apiGet<MetaSecretsStatus>("/api/automation/meta-secrets"),
      ]);
      setRules(rulesRes.rules);
      setSecrets(secretsRes);
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Failed to load rules", true);
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  /**
   * Fetch the Connected Pages list. Backend calls /me/accounts (Graph API
   * pages_show_list demo) — re-invoking this is the user-visible proof that
   * the permission is actively used. Kept separate from `refresh` so the
   * page list can be re-loaded without re-querying rules/secrets.
   */
  const refreshConnectedPages = useCallback(async () => {
    setPagesLoading(true);
    try {
      const data = await apiGet<ConnectedPagesResponse>("/api/automation/connected-pages");
      setPagesData(data);
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Failed to load connected pages", true);
    } finally {
      setPagesLoading(false);
    }
  }, [showMessage]);

  async function handleReconnectFacebook() {
    try {
      const { url } = await apiGet<{ url: string }>("/api/automation/fb-oauth-url");
      if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Failed to build OAuth URL", true);
    }
  }

  useEffect(() => {
    refresh();
    refreshConnectedPages();
  }, [refresh, refreshConnectedPages]);

  async function handleToggleEnabled(rule: AutoDmRule) {
    try {
      await apiSend(`/api/automation/rules/${rule.id}`, "PATCH", { enabled: !rule.enabled });
      showMessage(rule.enabled ? "Rule paused" : "Rule enabled");
      refresh();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Failed to toggle", true);
    }
  }

  async function handleDelete(rule: AutoDmRule) {
    if (typeof window !== "undefined" && !window.confirm(`Delete rule for "${rule.keyword}"?`)) return;
    try {
      await apiSend(`/api/automation/rules/${rule.id}`, "DELETE");
      showMessage("Rule deleted");
      refresh();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Failed to delete", true);
    }
  }

  function handleEdit(rule: AutoDmRule) {
    setEditingRule(rule);
    setShowForm(true);
  }

  function handleAdd() {
    setEditingRule(null);
    setShowForm(true);
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingRule(null);
  }

  function handleFormSaved() {
    handleFormClose();
    refresh();
  }

  // ── Setup banner (Meta not configured) ──────────────────────────────────────
  const setupBanner = secrets && !secrets.configured ? (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2" role="alert">
      <div className="text-sm font-medium text-amber-300">Meta App nicht vollständig konfiguriert</div>
      <p className="text-xs text-cc-muted">
        Auto-DM braucht eine Meta App + IG-Business-Account + OAuth-Grant. Rules kannst du anlegen, aber sie feuern erst wenn das Meta-Setup durch ist.
      </p>
      <ul className="text-[11px] text-cc-muted list-disc pl-5 space-y-0.5">
        <li>App ID: {secrets.appId ? <code className="text-cc-fg">{secrets.appId}</code> : <span className="text-amber-300">missing</span>}</li>
        <li>App Secret: {secrets.appSecretConfigured ? "✓" : <span className="text-amber-300">missing</span>}</li>
        <li>Page Access Token: {secrets.pageAccessTokenConfigured ? "✓" : <span className="text-amber-300">missing</span>}</li>
        <li>Webhook Verify Token: {secrets.webhookVerifyConfigured ? "✓" : <span className="text-amber-300">missing</span>}</li>
        <li>IG Business ID: {secrets.igBusinessId || <span className="text-amber-300">missing</span>}</li>
      </ul>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      {setupBanner}

      <ConnectedPagesCard
        data={pagesData}
        loading={pagesLoading}
        onRefresh={refreshConnectedPages}
        onReconnect={handleReconnectFacebook}
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-cc-fg">Auto-DM Rules</h2>
          <p className="text-[11px] text-cc-muted mt-0.5">
            Comment-Trigger → automatische DM via Meta Private Reply. Funktioniert auf IG + FB.
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 transition-colors"
          aria-label="Add new Auto-DM rule"
        >
          + New Rule
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-cc-muted">Loading…</div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-cc-border bg-cc-card p-6 text-center">
          <div className="text-sm font-medium text-cc-fg mb-1">Noch keine Rules</div>
          <p className="text-xs text-cc-muted">
            Lege eine Rule an und du-DM-st jeden der dein Keyword kommentiert. Klassisches Lead-Magnet-Funnel.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={() => handleToggleEnabled(rule)}
              onEdit={() => handleEdit(rule)}
              onDelete={() => handleDelete(rule)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <RuleForm
          rule={editingRule}
          onClose={handleFormClose}
          onSaved={handleFormSaved}
          showMessage={showMessage}
        />
      )}
    </div>
  );
}

// ─── ConnectedPagesCard ──────────────────────────────────────────────────────
//
// Demonstrates the `pages_show_list` + `business_management` Meta permissions
// in a user-visible way. Lists the Facebook Pages the connected user manages
// and marks the currently-active one. Refresh + Reconnect actions are
// explicitly shown so a Meta App Reviewer can verify the permissions are
// actually used during the screencast.

function ConnectedPagesCard({
  data,
  loading,
  onRefresh,
  onReconnect,
}: {
  data: ConnectedPagesResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onReconnect: () => void;
}) {
  return (
    <div className="rounded-xl border border-cc-border bg-cc-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-cc-fg">Connected Facebook Pages</div>
          <p className="text-[10px] text-cc-muted mt-0.5">
            Read via Meta Graph API <code className="text-cc-accent">/me/accounts</code> (uses{" "}
            <code className="text-cc-accent">pages_show_list</code> + <code className="text-cc-accent">business_management</code>).
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded border border-cc-border text-cc-muted hover:text-cc-fg hover:border-cc-accent/30 disabled:opacity-50"
            aria-label="Refresh connected pages"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            onClick={onReconnect}
            className="text-[10px] px-2 py-1 rounded border border-cc-accent/30 text-cc-accent hover:bg-cc-accent/10"
            aria-label="Reconnect Facebook account"
          >
            Reconnect Facebook
          </button>
        </div>
      </div>

      {data === null ? (
        <div className="text-xs text-cc-muted py-2">Loading…</div>
      ) : data.pages.length === 0 ? (
        <div className="text-xs text-cc-muted py-2">
          No pages found.{data.reason ? <> Reason: <span className="text-amber-300">{data.reason}</span></> : null}
          {data.needsReconnect ? <> — click <strong>Reconnect Facebook</strong> to grant access.</> : null}
        </div>
      ) : (
        <ul className="divide-y divide-cc-border/40">
          {data.pages.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 py-1.5">
              {p.picture ? (
                <img src={p.picture} alt="" width={28} height={28} className="w-7 h-7 rounded-full" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-cc-accent/10 flex items-center justify-center text-[10px] text-cc-accent">FB</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-cc-fg truncate">{p.name}</div>
                <div className="text-[10px] text-cc-muted font-mono truncate">{p.id}</div>
              </div>
              {p.isActive && (
                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">Active</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {data?.source === "page-token-fallback" && (
        <p className="text-[10px] text-amber-300 pt-1 border-t border-cc-border/30 mt-1">
          ⓘ Showing single-page fallback (System User token). Click <strong>Reconnect Facebook</strong> to enable full multi-page listing via /me/accounts.
        </p>
      )}
    </div>
  );
}

// ─── RuleCard ────────────────────────────────────────────────────────────────

function RuleCard({
  rule,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: AutoDmRule;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`rounded-xl border ${rule.enabled ? "border-cc-border bg-cc-card" : "border-cc-border/40 bg-cc-card/50"} p-3 space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ${
              rule.platform === "instagram"
                ? "bg-pink-500/20 text-pink-400"
                : "bg-blue-500/20 text-blue-400"
            }`}>
              {rule.platform}
            </span>
            <code className="text-xs font-mono text-cc-accent bg-cc-bg px-1.5 py-0.5 rounded">{rule.keyword}</code>
            {rule.postId ? (
              <span className="text-[9px] text-cc-muted">post-scoped</span>
            ) : (
              <span className="text-[9px] text-cc-muted">all posts</span>
            )}
            {!rule.enabled && (
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-cc-border/30 text-cc-muted">paused</span>
            )}
          </div>
          <p className="text-xs text-cc-fg/80 line-clamp-2">{rule.dmTemplate}</p>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-cc-muted">
            <span>Sent {rule.sentCount}× to {rule.sentTo.length} unique users</span>
            <span>•</span>
            <span>Updated {new Date(rule.updatedAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onToggle}
            className="text-[10px] px-2 py-1 rounded border border-cc-border text-cc-muted hover:text-cc-fg hover:border-cc-accent/30"
            aria-label={rule.enabled ? "Pause rule" : "Enable rule"}
          >
            {rule.enabled ? "Pause" : "Enable"}
          </button>
          <button
            onClick={onEdit}
            className="text-[10px] px-2 py-1 rounded border border-cc-border text-cc-muted hover:text-cc-fg hover:border-cc-accent/30"
            aria-label="Edit rule"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-[10px] px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
            aria-label="Delete rule"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RuleForm (modal) ────────────────────────────────────────────────────────

function RuleForm({
  rule,
  onClose,
  onSaved,
  showMessage,
}: {
  rule: AutoDmRule | null;
  onClose: () => void;
  onSaved: () => void;
  showMessage: (text: string, isError?: boolean) => void;
}) {
  const isEdit = !!rule;
  const [platform, setPlatform] = useState<Platform>(rule?.platform ?? "instagram");
  const [keyword, setKeyword] = useState(rule?.keyword ?? "");
  const [dmTemplate, setDmTemplate] = useState(rule?.dmTemplate ?? "");
  const [postId, setPostId] = useState(rule?.postId ?? "");
  const [notes, setNotes] = useState(rule?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim() || !dmTemplate.trim()) {
      showMessage("Keyword + DM template are required", true);
      return;
    }
    setSaving(true);
    try {
      const body = {
        platform,
        keyword: keyword.trim(),
        dmTemplate,
        postId: postId.trim() || null,
        notes: notes.trim() || undefined,
      };
      if (isEdit && rule) {
        await apiSend(`/api/automation/rules/${rule.id}`, "PATCH", body);
        showMessage("Rule updated");
      } else {
        await apiSend("/api/automation/rules", "POST", body);
        showMessage("Rule created");
      }
      onSaved();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Failed to save", true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="rule-form-title">
      <div className="bg-cc-bg border border-cc-border rounded-xl p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-3">
        <div className="flex items-center justify-between">
          <h3 id="rule-form-title" className="text-sm font-medium text-cc-fg">
            {isEdit ? "Edit Rule" : "New Auto-DM Rule"}
          </h3>
          <button onClick={onClose} className="text-cc-muted hover:text-cc-fg text-lg leading-none" aria-label="Close">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Platform</label>
            <div className="grid grid-cols-2 gap-2">
              {(["instagram", "facebook"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  className={`p-2 rounded-lg border text-xs font-medium ${
                    platform === p
                      ? "border-cc-accent bg-cc-accent/10 text-cc-accent"
                      : "border-cc-border bg-cc-card text-cc-muted hover:text-cc-fg"
                  }`}
                  aria-label={`Set platform to ${p}`}
                  aria-pressed={platform === p}
                >
                  {p === "instagram" ? "Instagram" : "Facebook"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="rule-keyword" className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Keyword (case-insensitive substring)</label>
            <input
              id="rule-keyword"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. COURSES"
              className="w-full text-xs px-2 py-1.5 rounded-md bg-cc-bg border border-cc-border text-cc-fg focus:border-cc-accent focus:outline-none"
              required
            />
          </div>

          <div>
            <label htmlFor="rule-template" className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">DM Template</label>
            <textarea
              id="rule-template"
              value={dmTemplate}
              onChange={(e) => setDmTemplate(e.target.value)}
              rows={4}
              placeholder="Hi! Here's the link you asked for: https://example.com"
              className="w-full text-xs px-2 py-1.5 rounded-md bg-cc-bg border border-cc-border text-cc-fg focus:border-cc-accent focus:outline-none resize-y"
              required
            />
            <p className="text-[10px] text-cc-muted mt-0.5">Max 1000 chars. Plain text only — links are auto-clickable.</p>
          </div>

          <div>
            <label htmlFor="rule-postid" className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Scope to specific Post ID (optional)</label>
            <input
              id="rule-postid"
              type="text"
              value={postId}
              onChange={(e) => setPostId(e.target.value)}
              placeholder="Leave empty for all posts on the platform"
              className="w-full text-xs px-2 py-1.5 rounded-md bg-cc-bg border border-cc-border text-cc-fg focus:border-cc-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="rule-notes" className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Notes (internal)</label>
            <input
              id="rule-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className="w-full text-xs px-2 py-1.5 rounded-md bg-cc-bg border border-cc-border text-cc-fg focus:border-cc-accent focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-cc-border text-cc-muted hover:text-cc-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Rule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
