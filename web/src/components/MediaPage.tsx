import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api.js";

interface MediaFile {
  filename: string;
  path: string;
}

interface ReferenceFile {
  filename: string;
  url: string;
  size: number;
  uploadedAt: number;
}

interface ReferenceCategory {
  name: string;
  count: number;
  files: ReferenceFile[];
}

type Tab = "generated" | "references";

export function MediaPage({ embedded: _embedded }: { embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>("generated");

  return (
    <div className="h-full overflow-y-auto bg-cc-bg">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-safe">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-cc-fg">Media</h1>
          <p className="text-xs text-cc-muted mt-1">
            Images and files created by agents, plus reference images for image generation.
          </p>
        </div>

        <div className="flex gap-1 mb-6 border-b border-cc-border" role="tablist" aria-label="Media tabs">
          <TabButton active={tab === "generated"} onClick={() => setTab("generated")}>
            Generated
          </TabButton>
          <TabButton active={tab === "references"} onClick={() => setTab("references")}>
            References
          </TabButton>
        </div>

        {tab === "generated" ? <GeneratedTab /> : <ReferencesTab />}
      </div>
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-cc-primary text-cc-fg"
          : "border-transparent text-cc-muted hover:text-cc-fg"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Generated Tab ───────────────────────────────────────────────────────────

function GeneratedTab() {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listMedia()
      .then((res) => setMediaFiles(res.files))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(mediaFiles.map((f) => f.filename)));
  const clearSelection = () => setSelected(new Set());

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    if (!window.confirm(`Delete ${count} file${count === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    try {
      await api.bulkDeleteMedia(Array.from(selected));
      setSelected(new Set());
      load();
    } catch {
      // ignore — UI will refetch
    } finally {
      setBusy(false);
    }
  };

  const deleteOne = async (filename: string) => {
    if (!window.confirm(`Delete "${filename}"?`)) return;
    setBusy(true);
    try {
      await api.deleteMedia(filename);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
      load();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-xs text-cc-muted">Loading...</p>;
  }

  if (mediaFiles.length === 0) {
    return (
      <div className="text-center py-16">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-8 h-8 text-cc-muted/30 mx-auto mb-3" aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" rx="2" />
          <circle cx="5.5" cy="5.5" r="1" />
          <path d="M2 11l3-3 2 2 3-4 4 5" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
        <p className="text-sm text-cc-muted">No media files yet</p>
        <p className="text-xs text-cc-muted mt-1">
          Generated images from agents and Gemini will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-cc-muted">
          {mediaFiles.length} file{mediaFiles.length === 1 ? "" : "s"}
          {selected.size > 0 ? ` · ${selected.size} selected` : ""}
        </p>
        <div className="flex gap-2">
          {selected.size > 0 ? (
            <>
              <button
                type="button"
                onClick={clearSelection}
                disabled={busy}
                className="text-xs px-2 py-1 rounded border border-cc-border text-cc-muted hover:text-cc-fg disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                disabled={busy}
                className="text-xs px-2 py-1 rounded border border-red-500/40 text-red-500 hover:bg-red-500/10 disabled:opacity-50"
              >
                Delete {selected.size}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={selectAll}
              disabled={busy || mediaFiles.length === 0}
              className="text-xs px-2 py-1 rounded border border-cc-border text-cc-muted hover:text-cc-fg disabled:opacity-50"
            >
              Select all
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {mediaFiles.map((file) => {
          const isSelected = selected.has(file.filename);
          return (
            <div
              key={file.filename}
              className={`group relative bg-cc-card border rounded-xl overflow-hidden transition-colors ${
                isSelected ? "border-cc-primary" : "border-cc-border hover:border-cc-primary/40"
              }`}
            >
              <label className="absolute top-2 left-2 z-10 flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(file.filename)}
                  aria-label={`Select ${file.filename}`}
                  className="w-4 h-4 rounded border-cc-border bg-cc-bg/80 cursor-pointer"
                />
              </label>
              <button
                type="button"
                onClick={() => deleteOne(file.filename)}
                disabled={busy}
                aria-label={`Delete ${file.filename}`}
                className="absolute top-2 right-2 z-10 w-6 h-6 rounded bg-cc-bg/80 text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500/10 transition-opacity flex items-center justify-center"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3" aria-hidden="true">
                  <path d="M6 2h4v1h3v1H3V3h3V2zm-2 3h8l-1 9H5L4 5zm3 2v6h1V7H7zm2 0v6h1V7H9z" />
                </svg>
              </button>
              <a
                href={`/api/media/file/${encodeURIComponent(file.filename)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src={`/api/media/file/${encodeURIComponent(file.filename)}`}
                  alt={file.filename}
                  className="w-full aspect-square object-cover"
                  loading="lazy"
                />
              </a>
              <div className="px-2.5 py-2">
                <p className="text-[11px] text-cc-muted truncate">{file.filename}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── References Tab ──────────────────────────────────────────────────────────

function ReferencesTab() {
  const [categories, setCategories] = useState<ReferenceCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listReferences()
      .then((res) => {
        setCategories(res.categories);
        setActiveCategory((current) => {
          if (current && res.categories.some((c) => c.name === current)) return current;
          return res.categories[0]?.name ?? null;
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addCategory = async () => {
    const name = window.prompt("Category name (letters, digits, _, -):");
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await api.createReferenceCategory(name.trim());
      setActiveCategory(name.trim());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = async (name: string) => {
    if (!window.confirm(`Delete empty category "${name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteReferenceCategory(name);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const triggerUpload = () => fileInputRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-uploading same file
    if (!activeCategory || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        await api.uploadReference(activeCategory, file);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeReference = async (category: string, filename: string) => {
    if (!window.confirm(`Delete "${filename}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteReference(category, filename);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const active = categories.find((c) => c.name === activeCategory) ?? null;

  if (loading) {
    return <p className="text-xs text-cc-muted">Loading...</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6">
      <aside className="space-y-1">
        <p className="text-[11px] uppercase tracking-wide text-cc-muted mb-2">Categories</p>
        {categories.map((cat) => (
          <div key={cat.name} className="flex items-center gap-1 group">
            <button
              type="button"
              onClick={() => setActiveCategory(cat.name)}
              className={`flex-1 text-left px-2 py-1.5 rounded text-xs transition-colors ${
                cat.name === activeCategory
                  ? "bg-cc-primary/10 text-cc-fg"
                  : "text-cc-muted hover:text-cc-fg hover:bg-cc-card"
              }`}
            >
              {cat.name}
              <span className="ml-1.5 text-cc-muted/70">{cat.count}</span>
            </button>
            {cat.count === 0 && (
              <button
                type="button"
                onClick={() => removeCategory(cat.name)}
                disabled={busy}
                aria-label={`Delete category ${cat.name}`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-5 h-5 text-red-500 hover:bg-red-500/10 rounded flex items-center justify-center"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3" aria-hidden="true">
                  <path d="M6 2h4v1h3v1H3V3h3V2zm-2 3h8l-1 9H5L4 5z" />
                </svg>
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addCategory}
          disabled={busy}
          className="w-full text-left px-2 py-1.5 rounded text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-card disabled:opacity-50"
        >
          + New category
        </button>
      </aside>

      <section>
        {error && (
          <div className="mb-3 px-3 py-2 rounded border border-red-500/40 bg-red-500/5 text-xs text-red-500">
            {error}
          </div>
        )}

        {active ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-cc-muted">
                <span className="text-cc-fg font-medium">{active.name}</span> · {active.count} file
                {active.count === 1 ? "" : "s"}
              </p>
              <button
                type="button"
                onClick={triggerUpload}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded border border-cc-border text-cc-fg hover:bg-cc-card disabled:opacity-50"
              >
                Upload images
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                onChange={onFileChange}
                className="hidden"
                aria-label="Upload reference images"
              />
            </div>

            {active.files.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-cc-border rounded-xl">
                <p className="text-sm text-cc-muted">No reference images in this category yet</p>
                <p className="text-xs text-cc-muted mt-1">
                  Upload a few — agents can use them as inputs for image generation.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {active.files.map((file) => (
                  <div
                    key={file.filename}
                    className="group relative bg-cc-card border border-cc-border rounded-xl overflow-hidden hover:border-cc-primary/40 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => removeReference(active.name, file.filename)}
                      disabled={busy}
                      aria-label={`Delete ${file.filename}`}
                      className="absolute top-2 right-2 z-10 w-6 h-6 rounded bg-cc-bg/80 text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500/10 transition-opacity flex items-center justify-center"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3" aria-hidden="true">
                        <path d="M6 2h4v1h3v1H3V3h3V2zm-2 3h8l-1 9H5L4 5z" />
                      </svg>
                    </button>
                    <a href={file.url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={file.url}
                        alt={file.filename}
                        className="w-full aspect-square object-cover"
                        loading="lazy"
                      />
                    </a>
                    <div className="px-2.5 py-2">
                      <p className="text-[11px] text-cc-muted truncate">{file.filename}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-cc-muted text-sm">
            No categories yet — create one to get started.
          </div>
        )}
      </section>
    </div>
  );
}
