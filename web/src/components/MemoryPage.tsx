// ─── Memory Page ────────────────────────────────────────────────────────────
// View, search, add, and delete user memories.

import { useState, useEffect, useCallback } from "react";
import { api } from "../api";

interface Memory {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("heyhank_auth_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export function MemoryPage({ embedded = false }: { embedded?: boolean }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [newMemory, setNewMemory] = useState("");
  const [adding, setAdding] = useState(false);
  const [backend, setBackend] = useState<string>("local");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [obsidianVaultPath, setObsidianVaultPath] = useState("");
  const [obsidianSaving, setObsidianSaving] = useState(false);
  const [obsidianSaved, setObsidianSaved] = useState(false);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPlatform, setImportPlatform] = useState<"auto" | "chatgpt" | "claude" | "gemini">("auto");
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importPreview, setImportPreview] = useState<{ platform: string; memories: string[]; conversations: number; messagesProcessed: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ saved: number; platform: string; message: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const url = searchQuery
        ? `/api/memory/search?q=${encodeURIComponent(searchQuery)}`
        : "/api/memory";
      const res = await fetch(url, { headers: getAuthHeaders() });
      const data = await res.json();
      setMemories(data.memories || []);
      if (data.backend) setBackend(data.backend);
    } catch { /* ignore */ }
    setLoading(false);
  }, [searchQuery]);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  useEffect(() => {
    api.getSettings().then((s: any) => {
      if (s.obsidianVaultPath) setObsidianVaultPath(s.obsidianVaultPath);
    }).catch(() => {});
  }, []);

  const addMemory = async () => {
    if (!newMemory.trim()) return;
    setAdding(true);
    try {
      await fetch("/api/memory", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ content: newMemory }),
      });
      setNewMemory("");
      loadMemories();
    } catch { /* ignore */ }
    setAdding(false);
  };

  const deleteMemory = async (id: string) => {
    try {
      await fetch(`/api/memory/${id}`, { method: "DELETE", headers: getAuthHeaders() });
      setMemories(prev => prev.filter(m => m.id !== id));
    } catch { /* ignore */ }
  };

  const startEdit = (memory: Memory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const saveEdit = async () => {
    if (!editingId || !editContent.trim()) return;
    try {
      const res = await fetch(`/api/memory/${editingId}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ content: editContent.trim() }),
      });
      if (res.ok) {
        setMemories(prev => prev.map(m => m.id === editingId ? { ...m, content: editContent.trim() } : m));
      }
    } catch { /* ignore */ }
    setEditingId(null);
    setEditContent("");
  };

  const handleImportFile = async () => {
    if (!importFile) return;
    setImportPreviewing(true);
    setImportError(null);
    setImportPreview(null);
    try {
      const text = await importFile.text();
      let data: unknown;

      // Handle ZIP files (just try JSON first)
      try {
        data = JSON.parse(text);
      } catch {
        setImportError("Could not parse file. Please upload a JSON file (conversations.json, memories.json, or conversation.json from your AI platform export).");
        setImportPreviewing(false);
        return;
      }

      // Detect and preview
      const res = await fetch("/api/memory/import", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          data,
          platform: importPlatform === "auto" ? undefined : importPlatform,
          options: { mode: "both", extractFacts: true, maxConversations: 500 },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        setImportError(err.error || "Import failed");
        setImportPreviewing(false);
        return;
      }

      const result = await res.json();
      if (result.errors?.length > 0 && result.saved === 0) {
        setImportError(result.errors.join(", "));
      } else {
        setImportResult({ saved: result.saved, platform: result.platform, message: result.message });
        loadMemories(); // refresh list
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    }
    setImportPreviewing(false);
  };

  const resetImport = () => {
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setShowImport(false);
  };

  return (
    <div className="h-full overflow-y-auto bg-cc-bg">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-safe space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-cc-fg">Memory</h1>
            <p className="text-sm text-cc-muted mt-1">
              What Hank remembers about you.
              {backend === "semantic" && <span className="ml-1 text-green-500 text-xs">(Semantic search ✓)</span>}
              {backend === "local-keyword" && <span className="ml-1 text-yellow-500 text-xs">(Keyword search — model loading...)</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowImport(!showImport)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-hover text-cc-muted hover:text-cc-fg border border-cc-border hover:border-cc-fg/30 transition-colors"
          >
            {showImport ? "Cancel" : "Import"}
          </button>
        </div>

        {showImport && (
          <div className="p-4 rounded-lg border border-cc-border bg-cc-card space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-cc-fg mb-1">Import Memories</h3>
              <p className="text-xs text-cc-muted">
                Import from Claude, ChatGPT, or Gemini. Upload your exported JSON file (conversations.json, memories.json, etc.)
              </p>
            </div>

            {/* Platform selector */}
            <div className="flex items-center gap-3">
              <label className="text-xs text-cc-muted">Platform:</label>
              <div className="flex gap-1">
                {(["auto", "chatgpt", "claude", "gemini"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setImportPlatform(p)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      importPlatform === p
                        ? "bg-cc-accent text-white"
                        : "bg-cc-hover text-cc-muted hover:text-cc-fg"
                    }`}
                  >
                    {p === "auto" ? "Auto-detect" : p === "chatgpt" ? "ChatGPT" : p === "claude" ? "Claude" : "Gemini"}
                  </button>
                ))}
              </div>
            </div>

            {/* File upload */}
            <div className="flex gap-2 items-center">
              <label className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-cc-border hover:border-cc-fg/30 cursor-pointer transition-colors">
                <svg className="w-4 h-4 text-cc-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className="text-xs text-cc-muted">
                  {importFile ? importFile.name : "Choose JSON file..."}
                </span>
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    setImportFile(e.target.files?.[0] || null);
                    setImportResult(null);
                    setImportError(null);
                  }}
                />
              </label>
              <button
                type="button"
                onClick={handleImportFile}
                disabled={!importFile || importPreviewing}
                className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-30 transition-colors"
              >
                {importPreviewing ? "Importing..." : "Import"}
              </button>
            </div>

            {/* Error */}
            {importError && (
              <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                {importError}
              </div>
            )}

            {/* Success */}
            {importResult && (
              <div className="px-3 py-2 rounded-md bg-green-500/10 border border-green-500/20 text-xs text-green-400">
                <p className="font-medium">{importResult.saved} memories imported from {importResult.platform}</p>
                <p className="mt-1 text-green-400/70">{importResult.message}</p>
                <button
                  type="button"
                  onClick={resetImport}
                  className="mt-2 text-xs text-cc-muted hover:text-cc-fg transition-colors"
                >
                  Close
                </button>
              </div>
            )}

            {/* Help */}
            <div className="text-[11px] text-cc-muted space-y-1">
              <p><strong className="text-cc-fg/70">ChatGPT:</strong> Settings &rarr; Data Controls &rarr; Export &rarr; upload <code className="text-cc-primary/70">conversations.json</code> or <code className="text-cc-primary/70">memories.json</code></p>
              <p><strong className="text-cc-fg/70">Claude:</strong> Settings &rarr; Account &rarr; Export Data &rarr; upload <code className="text-cc-primary/70">conversations.json</code></p>
              <p><strong className="text-cc-fg/70">Gemini:</strong> Google Takeout &rarr; Gemini Apps &rarr; upload <code className="text-cc-primary/70">conversation.json</code></p>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            className="flex-1 px-3 py-2 text-sm bg-cc-bg rounded-lg border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-primary"
            onKeyDown={e => { if (e.key === "Enter") loadMemories(); }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(""); }}
              className="px-3 py-2 text-sm rounded-lg bg-cc-hover text-cc-muted hover:text-cc-fg transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Add new memory */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newMemory}
            onChange={e => setNewMemory(e.target.value)}
            placeholder="Add a memory... (e.g. 'I prefer dark mode' or 'My timezone is CET')"
            className="flex-1 px-3 py-2 text-sm bg-cc-bg rounded-lg border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-primary"
            onKeyDown={e => { if (e.key === "Enter") addMemory(); }}
          />
          <button
            type="button"
            onClick={addMemory}
            disabled={!newMemory.trim() || adding}
            className="px-4 py-2 text-sm rounded-lg bg-cc-primary text-white font-medium disabled:opacity-30 hover:bg-cc-primary/90 transition-colors"
          >
            {adding ? "..." : "Add"}
          </button>
        </div>

        {/* Memory list */}
        {loading ? (
          <div className="text-center py-8 text-sm text-cc-muted">Loading...</div>
        ) : memories.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <svg className="w-10 h-10 mx-auto text-cc-muted/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
            <p className="text-sm text-cc-muted">
              {searchQuery ? "No memories found for this search." : "No memories yet"}
            </p>
            {!searchQuery && (
              <p className="text-xs text-cc-muted/70 max-w-xs mx-auto">
                Add a memory above, or chat with Hank — it will remember things about you automatically.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {memories.map(memory => (
              <div key={memory.id} className="flex items-start gap-3 px-4 py-3 rounded-lg border border-cc-border bg-cc-card group">
                <div className="flex-1 min-w-0">
                  {editingId === memory.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === "Escape") cancelEdit(); }}
                        className="w-full px-2 py-1.5 text-sm bg-cc-bg rounded border border-cc-primary/40 text-cc-fg focus:outline-none focus:ring-1 focus:ring-cc-primary resize-none"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={saveEdit} className="px-2.5 py-1 text-xs rounded bg-cc-primary text-white hover:bg-cc-primary/90 transition-colors">Save</button>
                        <button type="button" onClick={cancelEdit} className="px-2.5 py-1 text-xs rounded text-cc-muted hover:text-cc-fg transition-colors">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-cc-fg">{memory.content}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {memory.createdAt && (
                          <span className="text-xs text-cc-muted">
                            {new Date(memory.createdAt).toLocaleDateString()} {new Date(memory.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                        {memory.metadata?.source === "auto-extracted" && (
                          <span className="text-[10px] text-cc-primary/70 bg-cc-primary/10 px-1.5 py-0.5 rounded">auto</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {editingId !== memory.id && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => startEdit(memory)}
                      className="text-cc-muted hover:text-cc-fg transition-colors p-1"
                      title="Edit memory"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMemory(memory.id)}
                      className="text-cc-muted hover:text-red-400 transition-colors p-1"
                      title="Delete memory"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {/* Obsidian Sync */}
        <div className="border-t border-cc-border pt-4 mt-6">
          <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-3">Obsidian Vault Sync</h3>
          <p className="text-[11px] text-cc-muted mb-3">
            Sync memories as Markdown files to your Obsidian vault. Changes in Obsidian are synced back automatically.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={obsidianVaultPath}
              onChange={(e) => { setObsidianVaultPath(e.target.value); setObsidianSaved(false); }}
              placeholder="/path/to/your/obsidian/vault"
              className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent"
            />
            <button
              type="button"
              disabled={obsidianSaving}
              onClick={async () => {
                setObsidianSaving(true);
                try {
                  await api.updateSettings({ obsidianVaultPath: obsidianVaultPath.trim() });
                  setObsidianSaved(true);
                  setTimeout(() => setObsidianSaved(false), 3000);
                } catch { /* ignore */ }
                setObsidianSaving(false);
              }}
              className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-50 cursor-pointer"
            >
              {obsidianSaving ? "Saving..." : obsidianSaved ? "Saved!" : "Save"}
            </button>
          </div>
          {obsidianVaultPath && (
            <p className="text-[10px] text-cc-muted mt-2">
              Memories will be synced to: <code className="text-cc-fg">{obsidianVaultPath}/HeyHank/</code>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
