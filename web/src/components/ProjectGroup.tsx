import type { RefObject } from "react";
import type { ProjectGroup as ProjectGroupType } from "../utils/project-grouping.js";
import { SessionItem } from "./SessionItem.js";

interface ProjectGroupProps {
  group: ProjectGroupType;
  isCollapsed: boolean;
  onToggleCollapse: (projectKey: string) => void;
  currentSessionId: string | null;
  sessionNames: Map<string, string>;
  pendingPermissions: Map<string, Map<string, unknown>>;
  recentlyRenamed: Set<string>;
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
  isFirst: boolean;
}

export function ProjectGroup({
  group,
  isCollapsed,
  onToggleCollapse,
  currentSessionId,
  sessionNames,
  pendingPermissions,
  recentlyRenamed,
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
  isFirst,
}: ProjectGroupProps) {
  // Build collapsed preview: first 2 session names
  const collapsedPreview = isCollapsed
    ? group.sessions
        .slice(0, 2)
        .map((s) => sessionNames.get(s.id) || s.model || s.id.slice(0, 8))
        .join(", ") + (group.sessions.length > 2 ? ", ..." : "")
    : "";

  return (
    <div className={!isFirst ? "my-2 pt-2 border-t border-cc-separator" : ""}>
      {/* Group header */}
      <button
        onClick={() => onToggleCollapse(group.key)}
        className="w-full px-2 py-1.5 flex items-center gap-1.5 hover:bg-cc-hover rounded-md transition-colors cursor-pointer"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`w-2.5 h-2.5 text-cc-muted transition-transform ${isCollapsed ? "" : "rotate-90"}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        {/* Folder icon */}
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-cc-muted/60 shrink-0">
          <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l.622.621a.5.5 0 00.354.146H13.5A1.5 1.5 0 0115 4.707V12.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
        </svg>
        <span className="text-[12px] font-semibold text-cc-fg/80 truncate">
          {group.label}
        </span>

        {/* Status dots */}
        <span className="flex items-center gap-1 ml-auto shrink-0">
          {group.runningCount > 0 && (
            <span className="w-1 h-1 rounded-full bg-cc-success" title={`${group.runningCount} running`} />
          )}
          {group.permCount > 0 && (
            <span className="w-1 h-1 rounded-full bg-cc-warning" title={`${group.permCount} waiting`} />
          )}
        </span>

        {/* Count badge */}
        <span className="text-[10px] bg-cc-hover rounded-full px-1.5 py-0.5 text-cc-muted shrink-0">
          {group.sessions.length}
        </span>
      </button>

      {/* Collapsed preview */}
      {isCollapsed && collapsedPreview && (
        <div className="text-[10px] text-cc-muted/70 truncate pl-7 pb-1">
          {collapsedPreview}
        </div>
      )}

      {/* Session list */}
      {!isCollapsed && (
        <div className="space-y-px mt-1">
          {group.sessions.map((s) => {
            const permCount = pendingPermissions.get(s.id)?.size ?? 0;
            return (
              <SessionItem
                key={s.id}
                session={s}
                isActive={currentSessionId === s.id}
                sessionName={sessionNames.get(s.id)}
                permCount={permCount}
                isRecentlyRenamed={recentlyRenamed.has(s.id)}
                onSelect={onSelect}
                onStartRename={onStartRename}
                onArchive={onArchive}
                onUnarchive={onUnarchive}
                onDelete={onDelete}
                onClearRecentlyRenamed={onClearRecentlyRenamed}
                editingSessionId={editingSessionId}
                editingName={editingName}
                setEditingName={setEditingName}
                onConfirmRename={onConfirmRename}
                onCancelRename={onCancelRename}
                editInputRef={editInputRef}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
