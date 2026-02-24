import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type SavedPrompt } from "../api.js";
import { useStore } from "../store.js";
import { navigateHome, navigateToSession } from "../utils/routing.js";

interface PromptsPageProps {
  embedded?: boolean;
}

export function PromptsPage({ embedded = false }: PromptsPageProps) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const currentSessionId = useStore((s) => s.currentSessionId);
  const cwd = useStore((s) => {
    if (!s.currentSessionId) return "";
    return s.sessions.get(s.currentSessionId)?.cwd
      || s.sdkSessions.find((sdk) => sdk.sessionId === s.currentSessionId)?.cwd
      || "";
  });

  const filteredPrompts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return prompts;
    return prompts.filter((prompt) => {
      const haystack = `${prompt.name}\n${prompt.content}\n${prompt.scope}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [prompts, search]);
  const totalPrompts = prompts.length;
  const visiblePrompts = filteredPrompts.length;

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const items = await api.listPrompts(cwd || undefined, "global");
      setPrompts(items);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;

    setSaving(true);
    setError("");
    try {
      await api.createPrompt({
        name: name.trim(),
        content: content.trim(),
        scope: "global",
      });
      setName("");
      setContent("");
      setShowCreate(false);
      await loadPrompts();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deletePrompt(id);
      await loadPrompts();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSaveEdit() {
    if (!editingId || !editName.trim() || !editContent.trim()) return;
    try {
      await api.updatePrompt(editingId, {
        name: editName.trim(),
        content: editContent.trim(),
      });
      setEditingId(null);
      setEditName("");
      setEditContent("");
      await loadPrompts();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className={`${embedded ? "h-full" : "h-[100dvh]"} bg-cc-bg text-cc-fg font-sans-ui antialiased overflow-y-auto`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-safe">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-cc-fg">Saved Prompts</h1>
            <p className="mt-0.5 text-[13px] text-cc-muted leading-relaxed">
              Create reusable prompts — insert with <code className="text-cc-fg text-xs bg-cc-hover rounded px-1 py-0.5">@title</code> in the composer.
            </p>
          </div>
          {!embedded && (
            <button
              onClick={() => {
                if (currentSessionId) {
                  navigateToSession(currentSessionId);
                } else {
                  navigateHome();
                }
              }}
              className="px-3 py-2.5 min-h-[44px] rounded-lg text-sm text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer shrink-0"
            >
              Back
            </button>
          )}
        </div>

        {/* Toolbar: search + create CTA */}
        <div className="flex items-center gap-2 mt-4 mb-5">
          <div className="relative flex-1 min-w-0">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cc-muted pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or content..."
              className="w-full pl-9 pr-3 py-2.5 min-h-[44px] text-sm bg-cc-card rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
            />
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-colors cursor-pointer shrink-0 ${
              showCreate
                ? "bg-cc-active text-cc-fg"
                : "bg-cc-primary hover:bg-cc-primary-hover text-white"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              {showCreate ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M12 5v14M5 12h14" />}
            </svg>
            <span className="hidden sm:inline">{showCreate ? "Cancel" : "New Prompt"}</span>
          </button>
        </div>

        {/* Inline create form */}
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-6 rounded-xl bg-cc-card p-4 sm:p-5 space-y-3"
            style={{ animation: "fadeSlideIn 150ms ease-out" }}
          >
            <div>
              <label className="block text-xs font-medium text-cc-muted mb-1" htmlFor="prompt-name">
                Title
              </label>
              <input
                id="prompt-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="review-pr"
                className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-cc-muted mb-1" htmlFor="prompt-content">
                Content
              </label>
              <textarea
                id="prompt-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Review this PR and summarize risks, regressions, and missing tests."
                rows={4}
                className="w-full px-3 py-2.5 text-sm bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 resize-y transition-shadow"
              />
            </div>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-cc-error/10 text-xs text-cc-error">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <p className="text-[11px] text-cc-muted">
                Stored in <code className="text-[10px]">~/.companion/prompts.json</code>
              </p>
              <button
                type="submit"
                disabled={saving || !name.trim() || !content.trim()}
                className={`px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                  saving || !name.trim() || !content.trim()
                    ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                    : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                }`}
              >
                {saving ? "Saving..." : "Create Prompt"}
              </button>
            </div>
          </form>
        )}

        {/* Stats */}
        <div className="flex items-center gap-2 mb-3 text-[12px] text-cc-muted">
          <span>{visiblePrompts === totalPrompts ? `${totalPrompts} prompt${totalPrompts !== 1 ? "s" : ""}` : `${visiblePrompts} of ${totalPrompts}`}</span>
          <span className="text-cc-border">·</span>
          <span>global scope</span>
        </div>

        {/* Prompt list */}
        {loading ? (
          <div className="py-12 text-center text-sm text-cc-muted">Loading prompts...</div>
        ) : prompts.length === 0 ? (
          <div className="py-12 text-center text-sm text-cc-muted">No prompts yet.</div>
        ) : filteredPrompts.length === 0 ? (
          <div className="py-12 text-center text-sm text-cc-muted">No prompts match your search.</div>
        ) : (
          <div className="space-y-1">
            {filteredPrompts.map((prompt) => (
              <PromptRow
                key={prompt.id}
                prompt={prompt}
                isEditing={editingId === prompt.id}
                editName={editName}
                editContent={editContent}
                onEditNameChange={setEditName}
                onEditContentChange={setEditContent}
                onStartEdit={() => {
                  setEditingId(prompt.id);
                  setEditName(prompt.name);
                  setEditContent(prompt.content);
                }}
                onCancelEdit={() => {
                  setEditingId(null);
                  setEditName("");
                  setEditContent("");
                }}
                onSaveEdit={() => void handleSaveEdit()}
                onDelete={() => void handleDelete(prompt.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Prompt Row ──────────────────────────────────────────────────── */

interface PromptRowProps {
  prompt: SavedPrompt;
  isEditing: boolean;
  editName: string;
  editContent: string;
  onEditNameChange: (v: string) => void;
  onEditContentChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}

function PromptRow({
  prompt,
  isEditing,
  editName,
  editContent,
  onEditNameChange,
  onEditContentChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: PromptRowProps) {
  if (isEditing) {
    return (
      <div
        className="rounded-xl bg-cc-card p-4 space-y-3"
        style={{ animation: "fadeSlideIn 150ms ease-out" }}
      >
        <input
          value={editName}
          onChange={(e) => onEditNameChange(e.target.value)}
          placeholder="Prompt title"
          className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
        />
        <textarea
          value={editContent}
          onChange={(e) => onEditContentChange(e.target.value)}
          rows={4}
          className="w-full px-3 py-2.5 text-sm bg-cc-bg rounded-lg text-cc-fg focus:outline-none focus:ring-1 focus:ring-cc-primary/40 resize-y transition-shadow"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancelEdit}
            className="px-3 py-2.5 min-h-[44px] text-sm rounded-lg text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onSaveEdit}
            disabled={!editName.trim() || !editContent.trim()}
            className={`px-4 py-2.5 min-h-[44px] text-sm rounded-lg font-medium transition-colors ${
              editName.trim() && editContent.trim()
                ? "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                : "bg-cc-hover text-cc-muted cursor-not-allowed"
            }`}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-3 px-3 py-3 min-h-[44px] rounded-lg hover:bg-cc-hover/60 transition-colors">
      {/* Icon */}
      <div className="shrink-0 mt-0.5 w-7 h-7 rounded-md bg-cc-primary/10 flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-cc-primary">
          <path d="M7 8h10M7 12h6M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V5Z" />
        </svg>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-cc-fg truncate">{prompt.name}</span>
          <span className="text-[10px] uppercase tracking-wider text-cc-muted opacity-60">{prompt.scope}</span>
        </div>
        <p className="mt-0.5 text-xs text-cc-muted line-clamp-2 leading-relaxed">{prompt.content}</p>
      </div>

      {/* Actions — visible on hover (desktop) or always (mobile/touch) */}
      <div className="shrink-0 flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button
          onClick={onStartEdit}
          className="p-2 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:p-1.5 rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
          aria-label="Edit"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="p-2 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:p-1.5 rounded-md text-cc-muted hover:text-cc-error hover:bg-cc-error/10 transition-colors cursor-pointer"
          aria-label="Delete"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

