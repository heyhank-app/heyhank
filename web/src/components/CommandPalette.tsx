import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore } from "../store.js";

/* ------------------------------------------------------------------ */
/*  Static data                                                        */
/* ------------------------------------------------------------------ */

const PAGES = [
  { id: "home", label: "Home", hash: "#/", icon: "home" },
  { id: "agents", label: "Agents", hash: "#/agents", icon: "agent" },
  { id: "media", label: "Media", hash: "#/media", icon: "media" },
  { id: "settings", label: "Settings", hash: "#/settings", icon: "settings" },
  { id: "help", label: "Help", hash: "#/help", icon: "help" },
  { id: "runs", label: "Runs", hash: "#/runs", icon: "runs" },
  { id: "scheduled", label: "Scheduled", hash: "#/scheduled", icon: "clock" },
  { id: "telephony", label: "Telephony", hash: "#/telephony", icon: "phone" },
] as const;

const ACTIONS = [
  { id: "new-session", label: "New Session", hash: "#/new", icon: "plus" },
  { id: "dark-mode", label: "Toggle Dark Mode", action: "toggle-dark", icon: "theme" },
] as const;

/* ------------------------------------------------------------------ */
/*  Inline SVG icons (16x16)                                           */
/* ------------------------------------------------------------------ */

function Icon({ name, className = "w-4 h-4" }: { name: string; className?: string }) {
  const paths: Record<string, string> = {
    home: "M8 1.4L1 7v7.5A1.5 1.5 0 002.5 16h3a.5.5 0 00.5-.5V11a1 1 0 011-1h2a1 1 0 011 1v4.5a.5.5 0 00.5.5h3a1.5 1.5 0 001.5-1.5V7L8 1.4z",
    agent: "M8 0a4 4 0 00-4 4v1a4 4 0 008 0V4a4 4 0 00-4-4zM2 12a2 2 0 012-2h8a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2z",
    media: "M2 3a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm4.5 2.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM13 12l-3-4-2 2.5L6 8l-3 4h10z",
    settings: "M8 10a2 2 0 100-4 2 2 0 000 4zm6.32-1.906a1 1 0 00.195-1.104l-.707-1.414a1 1 0 00-1.104-.495l-.46.117a5.5 5.5 0 00-.962-.557l-.11-.468A1 1 0 0010.196 3H8.804a1 1 0 00-.977.773l-.11.468a5.5 5.5 0 00-.962.557l-.46-.117a1 1 0 00-1.104.495L4.485 6.59a1 1 0 00.195 1.104l.35.351a5.5 5.5 0 000 1.11l-.35.351a1 1 0 00-.195 1.104l.706 1.414a1 1 0 001.104.495l.46-.117c.298.22.622.408.963.557l.11.468a1 1 0 00.976.773h1.392a1 1 0 00.977-.773l.11-.468c.34-.149.664-.337.962-.557l.46.117a1 1 0 001.104-.495l.707-1.414a1 1 0 00-.195-1.104l-.35-.351a5.5 5.5 0 000-1.11l.35-.351z",
    help: "M8 0a8 8 0 100 16A8 8 0 008 0zm-.5 12.5a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM8 3.5A2.5 2.5 0 005.5 6h1.25a1.25 1.25 0 112.5 0c0 .73-.394 1.1-1.013 1.563C7.59 8.04 7.25 8.65 7.25 9.5h1.5c0-.46.2-.77.756-1.178C10.17 7.83 10.75 7.125 10.75 6A2.75 2.75 0 008 3.5z",
    runs: "M2 2.5A.5.5 0 012.5 2H5a.5.5 0 010 1H3v10h10v-2a.5.5 0 011 0v2.5a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5v-11zM8 3l5 5-5 5V9H5V7h3V3z",
    clock: "M8 0a8 8 0 100 16A8 8 0 008 0zm.5 3v5.25l3.1 1.85-.5.85L7.5 9V3h1z",
    phone: "M3.654 1.328a.678.678 0 00-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.6 17.6 0 004.168 6.608 17.6 17.6 0 006.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 00-.063-1.015l-2.307-1.794a.678.678 0 00-.58-.122l-2.19.547a1.745 1.745 0 01-1.657-.459L5.482 8.062a1.745 1.745 0 01-.46-1.657l.548-2.19a.678.678 0 00-.122-.58L3.654 1.328z",
    plus: "M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z",
    theme: "M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5V2.5a5.5 5.5 0 010 11z",
    search: "M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85-.017.016zM12 6.5a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z",
    session: "M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11zM4.5 2a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h7a.5.5 0 00.5-.5v-11a.5.5 0 00-.5-.5h-7z",
  };

  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d={paths[name] || paths.home} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Status dot (for sessions)                                          */
/* ------------------------------------------------------------------ */

function StatusDot({ state }: { state: string }) {
  const color =
    state === "running" ? "bg-green-500" :
    state === "connected" ? "bg-blue-500" :
    state === "starting" ? "bg-yellow-500" :
    "bg-cc-muted";

  return <span className={`inline-block w-2 h-2 rounded-full ${color} shrink-0`} />;
}

/* ------------------------------------------------------------------ */
/*  Result item type                                                   */
/* ------------------------------------------------------------------ */

interface ResultItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  category: "Pages" | "Actions" | "Sessions";
  onSelect: () => void;
  statusState?: string;
}

/* ------------------------------------------------------------------ */
/*  CommandPalette                                                     */
/* ------------------------------------------------------------------ */

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sdkSessions = useStore((s) => s.sdkSessions);
  const sessionNames = useStore((s) => s.sessionNames);

  /* ---------- Toggle open / close ---------- */

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  /* ---------- Global Cmd+K / Ctrl+K listener ---------- */

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => {
          if (prev) {
            // closing
            setQuery("");
            setSelectedIndex(0);
            return false;
          }
          return true;
        });
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /* ---------- Auto-focus input on open ---------- */

  useEffect(() => {
    if (open) {
      // Small delay to let the DOM render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  /* ---------- Build results ---------- */

  const results: ResultItem[] = useMemo(() => {
    const q = query.toLowerCase().trim();
    const items: ResultItem[] = [];

    // 1. Pages
    for (const page of PAGES) {
      if (!q || page.label.toLowerCase().includes(q)) {
        items.push({
          id: `page-${page.id}`,
          label: page.label,
          description: page.hash,
          icon: page.icon,
          category: "Pages",
          onSelect: () => {
            window.location.hash = page.hash;
            closeAndReset();
          },
        });
      }
    }

    // 2. Actions
    for (const action of ACTIONS) {
      if (!q || action.label.toLowerCase().includes(q)) {
        items.push({
          id: `action-${action.id}`,
          label: action.label,
          description: "action" in action ? undefined : (action as { hash?: string }).hash,
          icon: action.icon,
          category: "Actions",
          onSelect: () => {
            if ("action" in action && action.action === "toggle-dark") {
              useStore.getState().toggleDarkMode();
            } else if ("hash" in action && action.hash) {
              window.location.hash = action.hash;
            }
            closeAndReset();
          },
        });
      }
    }

    // 3. Sessions (only when there is a search query)
    if (q) {
      for (const sess of sdkSessions) {
        if (sess.archived) continue;
        const name = sessionNames.get(sess.sessionId) || sess.sessionId.slice(0, 8);
        const cwdShort = sess.cwd.length > 40 ? "..." + sess.cwd.slice(-37) : sess.cwd;
        const searchable = `${name} ${sess.cwd}`.toLowerCase();
        if (searchable.includes(q)) {
          items.push({
            id: `session-${sess.sessionId}`,
            label: name,
            description: cwdShort,
            icon: "session",
            category: "Sessions",
            statusState: sess.state,
            onSelect: () => {
              window.location.hash = `#/session/${sess.sessionId}`;
              closeAndReset();
            },
          });
        }
      }
    }

    return items;
  }, [query, sdkSessions, sessionNames, closeAndReset]);

  /* ---------- Reset selection when results change ---------- */

  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  /* ---------- Keyboard navigation ---------- */

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        results[selectedIndex]?.onSelect();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeAndReset();
      }
    },
    [results, selectedIndex, closeAndReset],
  );

  /* ---------- Scroll selected item into view ---------- */

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  /* ---------- Render ---------- */

  if (!open) return null;

  // Group results by category for section headers
  let lastCategory = "";

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
      style={{ animation: "palette-in 150ms ease-out" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeAndReset();
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-cc-card border border-cc-border shadow-lg overflow-hidden"
        style={{ animation: "palette-panel-in 150ms ease-out" }}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-cc-border">
          <Icon name="search" className="w-4 h-4 text-cc-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm text-cc-fg placeholder:text-cc-muted outline-none"
            placeholder="Search pages, actions, sessions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-cc-border bg-cc-bg px-1.5 py-0.5 text-[10px] text-cc-muted font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-cc-muted">No results found</div>
          )}
          {results.map((item, idx) => {
            const showHeader = item.category !== lastCategory;
            lastCategory = item.category;

            return (
              <div key={item.id}>
                {showHeader && (
                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-cc-muted">
                    {item.category}
                  </div>
                )}
                <button
                  type="button"
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors cursor-pointer ${
                    idx === selectedIndex ? "bg-cc-hover" : "hover:bg-cc-hover"
                  }`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => item.onSelect()}
                >
                  <Icon name={item.icon} className="w-4 h-4 text-cc-muted shrink-0" />
                  <span className="flex-1 truncate text-cc-fg">{item.label}</span>
                  {item.statusState && <StatusDot state={item.statusState} />}
                  {item.description && (
                    <span className="text-xs text-cc-muted truncate max-w-[160px]">
                      {item.description}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
