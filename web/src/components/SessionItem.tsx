import { useState, useEffect, useCallback, useRef, type RefObject } from "react";
import type { SessionItem as SessionItemType } from "../utils/project-grouping.js";
import { timeAgo } from "../utils/time-ago.js";

interface SessionItemProps {
  session: SessionItemType;
  isActive: boolean;
  isArchived?: boolean;
  sessionName: string | undefined;
  permCount: number;
  isRecentlyRenamed: boolean;
  onSelect: (id: string) => void;
  onStartRename: (id: string, currentName: string) => void;
  onArchive: (e: React.MouseEvent, id: string) => void;
  onUnarchive: (e: React.MouseEvent, id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onClearRecentlyRenamed: (id: string) => void;
  editingSessionId: string | null;
  editingName: string;
  setEditingName: (name: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
  editInputRef: RefObject<HTMLInputElement | null>;
}

export function SessionItem({
  session: s,
  isActive,
  isArchived: archived,
  sessionName,
  permCount,
  isRecentlyRenamed,
  onSelect,
  onStartRename,
  onArchive,
  onUnarchive,
  onDelete,
  onClearRecentlyRenamed,
  editingSessionId,
  editingName,
  setEditingName,
  onConfirmRename,
  onCancelRename,
  editInputRef,
}: SessionItemProps) {
  const shortId = s.id.slice(0, 8);
  const label = sessionName || s.model || shortId;
  const isRunning = s.status === "running";
  const isCompacting = s.status === "compacting";
  const isEditing = editingSessionId === s.id;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Status bar color
  const statusBarClass = archived
    ? "bg-cc-muted/20"
    : permCount > 0
    ? "bg-cc-warning"
    : s.sdkState === "exited"
    ? "bg-cc-muted/30"
    : isRunning
    ? "bg-cc-success"
    : isCompacting
    ? "bg-cc-warning/60"
    : "bg-cc-success/60";

  // Pulse animation for running or permissions
  const showPulse = !archived && (
    permCount > 0 || (isRunning && s.isConnected)
  );
  const pulseClass = permCount > 0
    ? "bg-cc-warning/40"
    : "bg-cc-success/40";

  // Backend dot color
  const backendDotColor = s.backendType === "codex"
    ? "bg-blue-500"
    : "bg-[#5BA8A0]";
  const backendLabel = s.backendType === "codex" ? "Codex" : "Claude";

  // Close menu on click outside or Escape
  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        menuBtnRef.current && !menuBtnRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const handleMenuAction = useCallback((action: () => void) => {
    setMenuOpen(false);
    action();
  }, []);

  // Whether row 2 (metadata) has any content
  const hasMetadata = s.gitBranch || s.gitAhead > 0 || s.gitBehind > 0 || s.linesAdded > 0 || s.linesRemoved > 0;

  return (
    <div className={`relative group ${archived ? "opacity-50" : ""}`}>
      <button
        onClick={() => onSelect(s.id)}
        onDoubleClick={(e) => {
          e.preventDefault();
          onStartRename(s.id, label);
        }}
        className={`w-full py-1.5 pl-3 pr-8 min-h-[44px] text-left rounded-lg transition-all duration-100 cursor-pointer ${
          isActive
            ? "bg-cc-active"
            : "hover:bg-cc-hover"
        }`}
      >
        {/* Left status bar */}
        <span className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full ${statusBarClass} transition-colors`} />
        {showPulse && (
          <span className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full ${pulseClass} animate-[pulse-dot_1.5s_ease-in-out_infinite]`} />
        )}

        {/* Row 1: Name + timestamp */}
        <div className="flex items-center gap-2">
          {isEditing ? (
            <input
              ref={editInputRef}
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onConfirmRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelRename();
                }
                e.stopPropagation();
              }}
              onBlur={onConfirmRename}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="text-[13px] font-medium flex-1 min-w-0 text-cc-fg bg-transparent border border-cc-border rounded px-1 py-0 outline-none focus:border-cc-primary/50"
            />
          ) : (
            <>
              <span
                className={`text-[13px] font-medium truncate text-cc-fg leading-snug flex-1 min-w-0 ${
                  isRecentlyRenamed ? "animate-name-appear" : ""
                }`}
                onAnimationEnd={() => onClearRecentlyRenamed(s.id)}
              >
                {label}
              </span>
              {s.createdAt > 0 && (
                <span className="text-[10px] text-cc-muted shrink-0 tabular-nums">
                  {timeAgo(s.createdAt)}
                </span>
              )}
            </>
          )}
        </div>

        {/* Row 2: Branch + backend dot + badges + git stats */}
        {(hasMetadata || !isEditing) && (
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            {s.gitBranch && (
              <div className="flex items-center gap-1 text-[11px] text-cc-muted leading-tight truncate min-w-0 flex-1">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0 opacity-50">
                  <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.116.862a2.25 2.25 0 10-.862.862A4.48 4.48 0 007.25 7.5h-1.5A2.25 2.25 0 003.5 9.75v.318a2.25 2.25 0 101.5 0V9.75a.75.75 0 01.75-.75h1.5a5.98 5.98 0 003.884-1.435A2.25 2.25 0 109.634 3.362zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
                </svg>
                <span className="truncate">{s.gitBranch}</span>
              </div>
            )}
            {!s.gitBranch && <div className="flex-1" />}

            {/* Backend dot indicator */}
            {!isEditing && (
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${backendDotColor}`} title={backendLabel} />
            )}

            {/* Docker icon */}
            {s.isContainerized && !isEditing && (
              <span title="Docker" className="shrink-0 flex items-center">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-blue-400">
                  <path d="M8.5 1a.5.5 0 00-.5.5V3H6V1.5a.5.5 0 00-1 0V3H3.5a.5.5 0 000 1H5v2H3.5a.5.5 0 000 1H5v1.5a.5.5 0 001 0V7h2v1.5a.5.5 0 001 0V7h1.5a.5.5 0 000-1H9V4h1.5a.5.5 0 000-1H9V1.5a.5.5 0 00-.5-.5zM8 4v2H6V4h2z" />
                </svg>
              </span>
            )}

            {/* Cron icon */}
            {s.cronJobId && !isEditing && (
              <span title="Cron" className="shrink-0 flex items-center">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-violet-400">
                  <path d="M8 2a6 6 0 100 12A6 6 0 008 2zM0 8a8 8 0 1116 0A8 8 0 010 8zm9-3a1 1 0 10-2 0v3a1 1 0 00.293.707l2 2a1 1 0 001.414-1.414L9 7.586V5z" />
                </svg>
              </span>
            )}

            {/* Inline git stats */}
            {(s.gitAhead > 0 || s.gitBehind > 0 || s.linesAdded > 0 || s.linesRemoved > 0) && !isEditing && (
              <span className="flex items-center gap-1 text-[10px] text-cc-muted shrink-0">
                {s.gitAhead > 0 && <span className="text-green-500">{s.gitAhead}&#8593;</span>}
                {s.gitBehind > 0 && <span className="text-cc-warning">{s.gitBehind}&#8595;</span>}
                {s.linesAdded > 0 && <span className="text-green-500">+{s.linesAdded}</span>}
                {s.linesRemoved > 0 && <span className="text-red-400">-{s.linesRemoved}</span>}
              </span>
            )}
          </div>
        )}
      </button>

      {/* Permission badge */}
      {!archived && permCount > 0 && !menuOpen && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-cc-warning text-white text-[10px] font-bold leading-none px-1 sm:group-hover:opacity-0 transition-opacity pointer-events-none">
          {permCount}
        </span>
      )}

      {/* Three-dot menu button */}
      <button
        ref={menuBtnRef}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!menuOpen);
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-cc-border text-cc-muted hover:text-cc-fg transition-all cursor-pointer"
        title="Session actions"
        aria-label="Session actions"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>

      {/* Context menu */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 w-36 py-1 bg-cc-card border border-cc-border rounded-lg shadow-lg z-10 animate-[menu-appear_150ms_ease-out]"
        >
          {!archived && (
            <button
              onClick={() => handleMenuAction(() => onStartRename(s.id, label))}
              className="w-full px-3 py-1.5 text-[12px] text-left text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            >
              Rename
            </button>
          )}
          {archived ? (
            <>
              <button
                onClick={(e) => handleMenuAction(() => onUnarchive(e, s.id))}
                className="w-full px-3 py-1.5 text-[12px] text-left text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
              >
                Restore
              </button>
              <button
                onClick={(e) => handleMenuAction(() => onDelete(e, s.id))}
                className="w-full px-3 py-1.5 text-[12px] text-left text-red-400 hover:bg-cc-hover transition-colors cursor-pointer"
              >
                Delete
              </button>
            </>
          ) : (
            <button
              onClick={(e) => handleMenuAction(() => onArchive(e, s.id))}
              className="w-full px-3 py-1.5 text-[12px] text-left text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            >
              Archive
            </button>
          )}
        </div>
      )}
    </div>
  );
}
