import { useEffect, useState } from "react";
import { api } from "../api.js";
import { navigateHome, navigateToSession } from "../utils/routing.js";
import { useStore } from "../store.js";

interface IntegrationsPageProps {
  embedded?: boolean;
}

interface McpPlugin {
  name: string;
  type: string;
  configured: boolean;
}

interface IntegrationStatus {
  emailAccounts: number;
  calendarAccounts: number;
  geminiConfigured: boolean;
  pushSubscriptions: number;
  claudeAuth: boolean;
  codexAuth: boolean;
  agents: number;
  mcpPlugins: McpPlugin[];
}

/* ── MCP Server Management Types ── */
interface McpAuthRequirement {
  field: string;
  label: string;
  helpText: string;
}

interface McpServerEntry {
  id: string;
  name: string;
  description: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
  assignedAgents: string[];
  requiresAuth?: McpAuthRequirement[];
  authValues?: Record<string, string>;
}

interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  type: "stdio" | "http" | "sse";
  requiresAuth?: McpAuthRequirement[];
}

const CATEGORY_LABELS: Record<string, string> = {
  browser: "Browser",
  search: "Search",
  productivity: "Productivity",
  development: "Development",
  database: "Database",
  communication: "Communication",
  ai: "AI",
  other: "Other",
};

/* ── MCP Server Management Component ── */
function McpServerManager() {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mcpError, setMcpError] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [authDrafts, setAuthDrafts] = useState<Record<string, Record<string, string>>>({});
  const [savingAuth, setSavingAuth] = useState<string | null>(null);

  // Custom server form state
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [customType, setCustomType] = useState<"stdio" | "http" | "sse">("stdio");
  const [customCommand, setCustomCommand] = useState("");
  const [customArgs, setCustomArgs] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customSaving, setCustomSaving] = useState(false);

  const loadData = async () => {
    try {
      const [srvResp, catResp] = await Promise.all([
        fetch("/api/mcp/servers").then((r) => r.ok ? r.json() : { servers: [] }).catch(() => ({ servers: [] })),
        fetch("/api/mcp/catalog").then((r) => r.ok ? r.json() : { catalog: [] }).catch(() => ({ catalog: [] })),
      ]);
      setServers(srvResp.servers || []);
      setCatalog(catResp.catalog || []);
    } catch (e: unknown) {
      setMcpError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const toggleServer = async (id: string) => {
    try {
      const resp = await fetch(`/api/mcp/servers/${id}/toggle`, { method: "POST" });
      if (!resp.ok) throw new Error("Toggle failed");
      const updated = await resp.json();
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
    } catch (e: unknown) {
      setMcpError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteServer = async (id: string) => {
    try {
      const resp = await fetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error("Delete failed");
      setServers((prev) => prev.filter((s) => s.id !== id));
      setConfirmDeleteId(null);
    } catch (e: unknown) {
      setMcpError(e instanceof Error ? e.message : String(e));
    }
  };

  const installFromCatalog = async (catalogId: string) => {
    setInstalling(catalogId);
    try {
      const resp = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogId }),
      });
      if (!resp.ok) throw new Error("Installation failed");
      const newServer = await resp.json();
      setServers((prev) => [...prev, newServer]);
      // If it needs auth, expand it immediately
      if (newServer.requiresAuth?.length) {
        setExpandedServerId(newServer.id);
        setShowCatalog(false);
      }
    } catch (e: unknown) {
      setMcpError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(null);
    }
  };

  const installCustomServer = async () => {
    if (!customName.trim()) return;
    setCustomSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: customName.trim(),
        description: customDesc.trim(),
        type: customType,
      };
      if (customType === "stdio") {
        body.command = customCommand.trim();
        body.args = customArgs.trim() ? customArgs.trim().split(/\s+/) : [];
      } else {
        body.url = customUrl.trim();
      }
      const resp = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error("Installation failed");
      const newServer = await resp.json();
      setServers((prev) => [...prev, newServer]);
      setShowCustomForm(false);
      setCustomName(""); setCustomDesc(""); setCustomCommand(""); setCustomArgs(""); setCustomUrl("");
      setCustomType("stdio");
    } catch (e: unknown) {
      setMcpError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomSaving(false);
    }
  };

  const saveAuthValues = async (id: string) => {
    const draft = authDrafts[id];
    if (!draft) return;
    setSavingAuth(id);
    try {
      const resp = await fetch(`/api/mcp/servers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authValues: draft }),
      });
      if (!resp.ok) throw new Error("Save failed");
      const updated = await resp.json();
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
      setAuthDrafts((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } catch (e: unknown) {
      setMcpError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAuth(null);
    }
  };

  const needsAuth = (s: McpServerEntry) =>
    s.requiresAuth?.length && (!s.authValues || s.requiresAuth.some((a) => !s.authValues?.[a.field]));

  const categories = Array.from(new Set(catalog.map((c) => c.category))).sort();
  const filteredCatalog = activeCategory === "all" ? catalog : catalog.filter((c) => c.category === activeCategory);
  const installedIds = new Set(servers.map((s) => s.name));

  const typeBadgeClass = (type: string) => {
    if (type === "stdio") return "border-blue-500/30 bg-blue-500/10 text-blue-400";
    if (type === "http") return "border-purple-500/30 bg-purple-500/10 text-purple-400";
    return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  };

  return (
    <div className="relative">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 rounded-full border border-cc-border bg-cc-hover/55 px-3 py-1.5 text-xs tracking-wide text-cc-muted">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66l4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66l4.24-4.24"/></svg>
          <span>MCP Server</span>
          <StatusDot active={servers.some((s) => s.enabled)} />
        </div>
      </div>
      <h2 className="mt-4 text-lg font-semibold text-cc-fg">Model Context Protocol</h2>
      <p className="mt-1 text-sm text-cc-muted">
        MCP servers give agents access to external tools (GitHub, Playwright, Slack, etc.).
      </p>

      {mcpError && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
          {mcpError}
          <button onClick={() => setMcpError("")} className="ml-2 underline cursor-pointer">OK</button>
        </div>
      )}

      {/* ── Installed Servers ── */}
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="py-4 text-center text-xs text-cc-muted animate-pulse">Loading MCP servers...</div>
        ) : servers.length === 0 ? (
          <div className="py-3 text-center text-xs text-cc-muted border border-dashed border-cc-border rounded-lg">
            No MCP servers installed
          </div>
        ) : (
          servers.map((srv) => (
            <div
              key={srv.id}
              className="rounded-xl border border-cc-border/70 bg-cc-bg/60 overflow-hidden transition-colors hover:border-cc-border"
            >
              {/* Server row */}
              <div className="flex items-center gap-3 px-3.5 py-2.5">
                {/* Expand toggle */}
                <button
                  onClick={() => setExpandedServerId(expandedServerId === srv.id ? null : srv.id)}
                  className="shrink-0 text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
                  title="Details"
                >
                  <svg className={`h-3.5 w-3.5 transition-transform ${expandedServerId === srv.id ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-cc-fg truncate">{srv.name}</span>
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider border ${typeBadgeClass(srv.type)}`}>
                      {srv.type}
                    </span>
                    {needsAuth(srv) && (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border border-amber-500/30 bg-amber-500/10 text-amber-400">
                        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                        Credentials missing
                      </span>
                    )}
                  </div>
                  {srv.description && (
                    <p className="text-xs text-cc-muted truncate mt-0.5">{srv.description}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Enable/disable toggle */}
                  <button
                    onClick={() => toggleServer(srv.id)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${srv.enabled ? "bg-cc-success" : "bg-cc-muted/30"}`}
                    title={srv.enabled ? "Disable" : "Enable"}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${srv.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>

                  {/* Delete */}
                  {confirmDeleteId === srv.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deleteServer(srv.id)}
                        className="px-2 py-1 text-[10px] rounded bg-cc-error/20 text-cc-error border border-cc-error/30 hover:bg-cc-error/30 cursor-pointer"
                      >
                        Yes, delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 text-[10px] rounded bg-cc-hover text-cc-muted border border-cc-border hover:text-cc-fg cursor-pointer"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(srv.id)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-cc-muted hover:text-cc-error hover:bg-cc-error/10 transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {expandedServerId === srv.id && (
                <div className="border-t border-cc-border/50 bg-cc-bg/40 px-3.5 py-3 space-y-3">
                  {/* Connection info */}
                  <div className="text-xs text-cc-muted space-y-1">
                    {srv.command && <div><span className="text-cc-fg/70">Command:</span> <code className="bg-black/20 px-1.5 py-0.5 rounded text-[11px]">{srv.command} {srv.args?.join(" ")}</code></div>}
                    {srv.url && <div><span className="text-cc-fg/70">URL:</span> <code className="bg-black/20 px-1.5 py-0.5 rounded text-[11px]">{srv.url}</code></div>}
                    {srv.assignedAgents.length > 0 && (
                      <div><span className="text-cc-fg/70">Assigned agents:</span> {srv.assignedAgents.join(", ")}</div>
                    )}
                  </div>

                  {/* Auth fields */}
                  {srv.requiresAuth && srv.requiresAuth.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-cc-fg/80">Credentials</div>
                      {srv.requiresAuth.map((auth) => {
                        const currentVal = authDrafts[srv.id]?.[auth.field] ?? srv.authValues?.[auth.field] ?? "";
                        return (
                          <div key={auth.field}>
                            <label className="block text-[11px] text-cc-muted mb-1">{auth.label}</label>
                            <input
                              type="password"
                              value={currentVal}
                              placeholder={auth.helpText}
                              onChange={(e) =>
                                setAuthDrafts((prev) => ({
                                  ...prev,
                                  [srv.id]: { ...(prev[srv.id] || {}), [auth.field]: e.target.value },
                                }))
                              }
                              className="w-full rounded-lg border border-cc-border bg-cc-bg px-2.5 py-1.5 text-xs text-cc-fg placeholder:text-cc-muted/50 focus:outline-none focus:border-cc-primary/50"
                            />
                          </div>
                        );
                      })}
                      {authDrafts[srv.id] && Object.keys(authDrafts[srv.id]).length > 0 && (
                        <button
                          onClick={() => saveAuthValues(srv.id)}
                          disabled={savingAuth === srv.id}
                          className="px-3 py-1.5 text-xs rounded-lg bg-cc-primary/20 text-cc-primary border border-cc-primary/30 hover:bg-cc-primary/30 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {savingAuth === srv.id ? "Saving..." : "Save credentials"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Add Server Button ── */}
      <div className="mt-4 flex gap-2 flex-wrap">
        <button
          onClick={() => { setShowCatalog(!showCatalog); setShowCustomForm(false); }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-cc-primary/30 bg-cc-primary/12 text-cc-fg hover:bg-cc-primary/20 hover:border-cc-primary/50 transition-colors cursor-pointer"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
          {showCatalog ? "Close catalog" : "Add MCP server"}
        </button>
        <button
          onClick={() => { setShowCustomForm(!showCustomForm); setShowCatalog(false); }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-cc-border text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          {showCustomForm ? "Cancel" : "Custom server"}
        </button>
      </div>

      {/* ── Custom Server Form ── */}
      {showCustomForm && (
        <div className="mt-3 rounded-xl border border-cc-border/70 bg-cc-bg/60 p-4 space-y-3">
          <div className="text-sm font-medium text-cc-fg">Add custom MCP server</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] text-cc-muted mb-1">Name *</label>
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} className="w-full rounded-lg border border-cc-border bg-cc-bg px-2.5 py-1.5 text-xs text-cc-fg placeholder:text-cc-muted/50 focus:outline-none focus:border-cc-primary/50" placeholder="e.g. my-mcp-server" />
            </div>
            <div>
              <label className="block text-[11px] text-cc-muted mb-1">Type</label>
              <select value={customType} onChange={(e) => setCustomType(e.target.value as "stdio" | "http" | "sse")} className="w-full rounded-lg border border-cc-border bg-cc-bg px-2.5 py-1.5 text-xs text-cc-fg focus:outline-none focus:border-cc-primary/50 cursor-pointer">
                <option value="stdio">stdio</option>
                <option value="http">http</option>
                <option value="sse">sse</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-cc-muted mb-1">Description</label>
            <input value={customDesc} onChange={(e) => setCustomDesc(e.target.value)} className="w-full rounded-lg border border-cc-border bg-cc-bg px-2.5 py-1.5 text-xs text-cc-fg placeholder:text-cc-muted/50 focus:outline-none focus:border-cc-primary/50" placeholder="What does this server do?" />
          </div>
          {customType === "stdio" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] text-cc-muted mb-1">Command *</label>
                <input value={customCommand} onChange={(e) => setCustomCommand(e.target.value)} className="w-full rounded-lg border border-cc-border bg-cc-bg px-2.5 py-1.5 text-xs text-cc-fg placeholder:text-cc-muted/50 focus:outline-none focus:border-cc-primary/50" placeholder="npx / bun / python" />
              </div>
              <div>
                <label className="block text-[11px] text-cc-muted mb-1">Arguments</label>
                <input value={customArgs} onChange={(e) => setCustomArgs(e.target.value)} className="w-full rounded-lg border border-cc-border bg-cc-bg px-2.5 py-1.5 text-xs text-cc-fg placeholder:text-cc-muted/50 focus:outline-none focus:border-cc-primary/50" placeholder="-y @some/package" />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] text-cc-muted mb-1">URL *</label>
              <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} className="w-full rounded-lg border border-cc-border bg-cc-bg px-2.5 py-1.5 text-xs text-cc-fg placeholder:text-cc-muted/50 focus:outline-none focus:border-cc-primary/50" placeholder="https://..." />
            </div>
          )}
          <button
            onClick={installCustomServer}
            disabled={customSaving || !customName.trim() || (customType === "stdio" ? !customCommand.trim() : !customUrl.trim())}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-cc-primary/20 text-cc-primary border border-cc-primary/30 hover:bg-cc-primary/30 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {customSaving ? "Installing..." : "Add server"}
          </button>
        </div>
      )}

      {/* ── Catalog Browser ── */}
      {showCatalog && (
        <div className="mt-3 space-y-3">
          {/* Category filter */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors cursor-pointer ${activeCategory === "all" ? "border-cc-primary/40 bg-cc-primary/15 text-cc-fg" : "border-cc-border text-cc-muted hover:text-cc-fg hover:bg-cc-hover"}`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors cursor-pointer ${activeCategory === cat ? "border-cc-primary/40 bg-cc-primary/15 text-cc-fg" : "border-cc-border text-cc-muted hover:text-cc-fg hover:bg-cc-hover"}`}
              >
                {CATEGORY_LABELS[cat] || cat}
              </button>
            ))}
          </div>

          {/* Catalog items */}
          {filteredCatalog.length === 0 ? (
            <div className="py-4 text-center text-xs text-cc-muted">No catalog entries found.</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {filteredCatalog.map((item) => {
                const alreadyInstalled = installedIds.has(item.name);
                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 rounded-xl border border-cc-border/70 bg-cc-bg/60 p-3 transition-colors hover:border-cc-border"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-cc-fg">{item.name}</span>
                        <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider border ${typeBadgeClass(item.type)}`}>
                          {item.type}
                        </span>
                        <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] border border-cc-border bg-cc-hover/50 text-cc-muted">
                          {CATEGORY_LABELS[item.category] || item.category}
                        </span>
                      </div>
                      <p className="text-xs text-cc-muted mt-1 line-clamp-2">{item.description}</p>
                      {item.requiresAuth?.length ? (
                        <p className="text-[10px] text-amber-400 mt-1">Requires credentials</p>
                      ) : null}
                    </div>
                    <button
                      onClick={() => !alreadyInstalled && installFromCatalog(item.id)}
                      disabled={alreadyInstalled || installing === item.id}
                      className={`shrink-0 px-3 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer disabled:cursor-not-allowed ${
                        alreadyInstalled
                          ? "border-cc-success/30 bg-cc-success/10 text-cc-success disabled:opacity-70"
                          : "border-cc-primary/30 bg-cc-primary/12 text-cc-primary hover:bg-cc-primary/25 disabled:opacity-50"
                      }`}
                    >
                      {installing === item.id ? "..." : alreadyInstalled ? "Installed" : "Install"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return active ? (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full bg-cc-success shadow-[0_0_0_3px_rgba(34,197,94,0.15)]"
      aria-label="Active"
    />
  ) : (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full bg-cc-muted/40"
      aria-label="Not configured"
    />
  );
}

function SettingsButton({ section }: { section: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.hash = "#/settings";
        // Scroll to section after navigation
        requestAnimationFrame(() => {
          setTimeout(() => {
            document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        });
      }}
      aria-label="Open settings"
      title="Configure"
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cc-primary/28 bg-cc-primary/12 text-cc-fg transition-colors hover:border-cc-primary/50 hover:bg-cc-primary/20 focus:outline-none focus:ring-2 focus:ring-cc-primary/35 cursor-pointer"
    >
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9.67 4.53 10 2h4l.33 2.53a7.9 7.9 0 0 1 1.7.7l2.03-1.55 2.83 2.83-1.55 2.03c.28.54.51 1.1.7 1.7L22 10v4l-2.53.33a7.9 7.9 0 0 1-.7 1.7l1.55 2.03-2.83 2.83-2.03-1.55c-.54.28-1.1.51-1.7.7L14 22h-4l-.33-2.53a7.9 7.9 0 0 1-1.7-.7l-2.03 1.55-2.83-2.83 1.55-2.03a7.9 7.9 0 0 1-.7-1.7L2 14v-4l2.53-.33c.19-.6.42-1.16.7-1.7L3.68 5.94 6.5 3.1l2.03 1.55c.54-.28 1.1-.51 1.7-.7Z" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    </button>
  );
}

export function IntegrationsPage({ embedded = false }: IntegrationsPageProps) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const [settings, agents, emailResp, calendarResp, mcpResp] = await Promise.all([
          api.getSettings(),
          api.listAgents(),
          fetch("/api/email-accounts").then((r) => r.ok ? r.json() : []).catch(() => []),
          fetch("/api/calendar-accounts").then((r) => r.ok ? r.json() : []).catch(() => []),
          fetch("/api/mcp/plugins").then((r) => r.ok ? r.json() : { plugins: [] }).catch(() => ({ plugins: [] })),
        ]);

        const emailCount = Array.isArray(emailResp) ? emailResp.length : 0;
        const calCount = Array.isArray(calendarResp) ? calendarResp.length : 0;

        // Check push subscriptions
        let pushCount = 0;
        try {
          const pushResp = await fetch("/api/push/status");
          if (pushResp.ok) {
            const pushData = await pushResp.json();
            pushCount = pushData.subscriptions ?? 0;
          }
        } catch { /* ignore */ }

        setStatus({
          emailAccounts: emailCount,
          calendarAccounts: calCount,
          geminiConfigured: !!settings.geminiApiKeyConfigured,
          pushSubscriptions: pushCount,
          claudeAuth: !!settings.claudeCliAuth,
          codexAuth: !!settings.codexCliAuth,
          agents: agents.length,
          mcpPlugins: mcpResp.plugins || [],
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
  }, []);

  return (
    <div className={`${embedded ? "h-full" : "h-[100dvh]"} bg-cc-bg text-cc-fg font-sans-ui antialiased overflow-y-auto`}>
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-safe">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-cc-fg">Integrations</h1>
            <p className="mt-1 text-sm text-cc-muted">
              Connected services and their status.
            </p>
          </div>
          {!embedded && (
            <button
              onClick={() => {
                const sessionId = useStore.getState().currentSessionId;
                if (sessionId) {
                  navigateToSession(sessionId);
                } else {
                  navigateHome();
                }
              }}
              className="px-3 py-2.5 min-h-[44px] rounded-lg text-sm text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            >
              Back
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
            {error}
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">

          {/* Gemini Live */}
          <section className="group relative overflow-hidden rounded-2xl border border-cc-border/80 bg-cc-card p-5 transition-all duration-300 hover:border-cc-primary/35 hover:shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_140%_at_100%_0%,rgba(59,130,246,0.12),transparent_52%)]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 rounded-full border border-cc-border bg-cc-hover/55 px-3 py-1.5 text-xs tracking-wide text-cc-muted">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                  <span>Gemini Live</span>
                  <StatusDot active={status?.geminiConfigured ?? false} />
                </div>
                <SettingsButton section="gemini" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-cc-fg">Voice Assistant</h2>
              <p className="mt-1 text-sm text-cc-muted">
                Real-time voice control with Google Gemini. Controls agents, calendar, emails and todos by voice.
              </p>
              <div className="mt-3 inline-flex items-center rounded-lg border border-cc-border/80 bg-black/10 px-3 py-1.5 text-xs text-cc-muted/95">
                {status?.geminiConfigured ? "API key configured" : "Not configured"}
              </div>
            </div>
          </section>

          {/* Email */}
          <section className="group relative overflow-hidden rounded-2xl border border-cc-border/80 bg-cc-card p-5 transition-all duration-300 hover:border-cc-primary/35 hover:shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_140%_at_100%_0%,rgba(251,146,60,0.12),transparent_52%)]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 rounded-full border border-cc-border bg-cc-hover/55 px-3 py-1.5 text-xs tracking-wide text-cc-muted">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  <span>Email</span>
                  <StatusDot active={(status?.emailAccounts ?? 0) > 0} />
                </div>
                <SettingsButton section="email" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-cc-fg">IMAP/SMTP Email</h2>
              <p className="mt-1 text-sm text-cc-muted">
                Email accounts via IMAP/SMTP. Gemini can read, search, send and summarize emails.
              </p>
              <div className="mt-3 inline-flex items-center rounded-lg border border-cc-border/80 bg-black/10 px-3 py-1.5 text-xs text-cc-muted/95">
                {(status?.emailAccounts ?? 0) > 0
                  ? `${status!.emailAccounts} account${status!.emailAccounts > 1 ? "s" : ""} connected`
                  : "No accounts"}
              </div>
            </div>
          </section>

          {/* Calendar */}
          <section className="group relative overflow-hidden rounded-2xl border border-cc-border/80 bg-cc-card p-5 transition-all duration-300 hover:border-cc-primary/35 hover:shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_140%_at_100%_0%,rgba(34,197,94,0.12),transparent_52%)]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 rounded-full border border-cc-border bg-cc-hover/55 px-3 py-1.5 text-xs tracking-wide text-cc-muted">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                  <span>Calendar</span>
                  <StatusDot active={(status?.calendarAccounts ?? 0) > 0} />
                </div>
                <SettingsButton section="calendar" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-cc-fg">CalDAV Calendar</h2>
              <p className="mt-1 text-sm text-cc-muted">
                Google Calendar, iCloud, Outlook via CalDAV. View, create and manage events.
              </p>
              <div className="mt-3 inline-flex items-center rounded-lg border border-cc-border/80 bg-black/10 px-3 py-1.5 text-xs text-cc-muted/95">
                {(status?.calendarAccounts ?? 0) > 0
                  ? `${status!.calendarAccounts} account${status!.calendarAccounts > 1 ? "s" : ""} connected`
                  : "No accounts"}
              </div>
            </div>
          </section>

          {/* Push Notifications */}
          <section className="group relative overflow-hidden rounded-2xl border border-cc-border/80 bg-cc-card p-5 transition-all duration-300 hover:border-cc-primary/35 hover:shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_140%_at_100%_0%,rgba(168,85,247,0.12),transparent_52%)]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 rounded-full border border-cc-border bg-cc-hover/55 px-3 py-1.5 text-xs tracking-wide text-cc-muted">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
                  <span>Push Notifications</span>
                  <StatusDot active={(status?.pushSubscriptions ?? 0) > 0} />
                </div>
                <SettingsButton section="notifications" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-cc-fg">Agent Alerts</h2>
              <p className="mt-1 text-sm text-cc-muted">
                Web push notifications when agents are done or need attention.
              </p>
              <div className="mt-3 inline-flex items-center rounded-lg border border-cc-border/80 bg-black/10 px-3 py-1.5 text-xs text-cc-muted/95">
                {(status?.pushSubscriptions ?? 0) > 0
                  ? `${status!.pushSubscriptions} subscription${status!.pushSubscriptions > 1 ? "s" : ""} active`
                  : "Not enabled"}
              </div>
            </div>
          </section>

          {/* LLM Providers */}
          <section className="group relative overflow-hidden rounded-2xl border border-cc-border/80 bg-cc-card p-5 transition-all duration-300 hover:border-cc-primary/35 hover:shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_140%_at_100%_0%,rgba(234,179,8,0.12),transparent_52%)]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 rounded-full border border-cc-border bg-cc-hover/55 px-3 py-1.5 text-xs tracking-wide text-cc-muted">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="7.5 4.21 12 6.81 16.5 4.21"/><polyline points="7.5 19.79 7.5 14.6 3 12"/><polyline points="21 12 16.5 14.6 16.5 19.79"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" x2="12" y1="22.08" y2="12"/></svg>
                  <span>LLM Providers</span>
                  <StatusDot active={status?.claudeAuth ?? false} />
                </div>
                <SettingsButton section="providers" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-cc-fg">Claude, Codex, Ollama</h2>
              <p className="mt-1 text-sm text-cc-muted">
                LLM backends for agent sessions. Claude Code CLI, OpenAI Codex, local Ollama.
              </p>
              <div className="mt-3 inline-flex items-center gap-3 text-xs text-cc-muted/95">
                <span className={`inline-flex items-center gap-1 rounded-lg border border-cc-border/80 bg-black/10 px-2.5 py-1.5 ${status?.claudeAuth ? "text-cc-success" : ""}`}>
                  Claude {status?.claudeAuth ? "OK" : "--"}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-lg border border-cc-border/80 bg-black/10 px-2.5 py-1.5 ${status?.codexAuth ? "text-cc-success" : ""}`}>
                  Codex {status?.codexAuth ? "OK" : "--"}
                </span>
              </div>
            </div>
          </section>

          {/* Agents */}
          <section className="group relative overflow-hidden rounded-2xl border border-cc-border/80 bg-cc-card p-5 transition-all duration-300 hover:border-cc-primary/35 hover:shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_140%_at_100%_0%,rgba(236,72,153,0.12),transparent_52%)]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 rounded-full border border-cc-border bg-cc-hover/55 px-3 py-1.5 text-xs tracking-wide text-cc-muted">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/></svg>
                  <span>Agents</span>
                  <StatusDot active={(status?.agents ?? 0) > 0} />
                </div>
                <button
                  type="button"
                  onClick={() => { window.location.hash = "#/agents"; }}
                  aria-label="Open agents"
                  title="Manage agents"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cc-primary/28 bg-cc-primary/12 text-cc-fg transition-colors hover:border-cc-primary/50 hover:bg-cc-primary/20 focus:outline-none focus:ring-2 focus:ring-cc-primary/35 cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              <h2 className="mt-4 text-lg font-semibold text-cc-fg">Agent Configuration</h2>
              <p className="mt-1 text-sm text-cc-muted">
                Configured agents with custom system prompts, models and working directories.
              </p>
              <div className="mt-3 inline-flex items-center rounded-lg border border-cc-border/80 bg-black/10 px-3 py-1.5 text-xs text-cc-muted/95">
                {(status?.agents ?? 0) > 0
                  ? `${status!.agents} agent${status!.agents > 1 ? "s" : ""} configured`
                  : "No agents"}
              </div>
            </div>
          </section>

          {/* MCP Server Management — full width */}
          <section className="sm:col-span-2 group relative overflow-hidden rounded-2xl border border-cc-border/80 bg-cc-card p-5 transition-all duration-300 hover:border-cc-primary/35 hover:shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_140%_at_100%_0%,rgba(16,185,129,0.10),transparent_52%)]" />
            <div className="relative">
              <McpServerManager />
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
