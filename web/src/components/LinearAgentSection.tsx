import type { AgentInfo } from "../api.js";
import { LinearLogo } from "./LinearLogo.js";

interface LinearAgentSectionProps {
  agents: AgentInfo[];
  onEdit: (agent: AgentInfo) => void;
  onRun: (agent: AgentInfo) => void;
  onAddNew: () => void;
  onManageCredentials: () => void;
}

export function LinearAgentSection({
  agents,
  onEdit,
  onRun,
  onAddNew,
  onManageCredentials,
}: LinearAgentSectionProps) {
  return (
    <div className="rounded-xl border border-cc-border bg-cc-card p-4 mb-4">
      {/* Section header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <LinearLogo className="w-4 h-4 text-cc-primary" />
          <h3 className="text-sm font-medium text-cc-fg">Linear Agents</h3>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={onAddNew}
            className="text-xs text-cc-primary hover:text-cc-primary-hover cursor-pointer"
          >
            + Add Linear Agent
          </button>
          <button
            onClick={onManageCredentials}
            className="text-[10px] text-cc-muted hover:text-cc-fg cursor-pointer"
          >
            Manage OAuth
          </button>
        </div>
      </div>

      {/* Agent list or empty state */}
      {agents.length === 0 ? (
        <p className="text-xs text-cc-muted text-center mt-4">
          No Linear agents yet. Create one to respond to @mentions in Linear.
        </p>
      ) : (
        <div className="mt-3 rounded-lg border border-cc-border/50 divide-y divide-cc-border/50">
          {agents.map((agent, index) => (
            <div
              key={agent.id}
              className="flex items-center justify-between px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-cc-fg truncate">{agent.name}</span>
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-cc-hover text-cc-muted">
                  {agent.backendType === "codex" ? "Codex" : "Claude"}
                </span>
                {index === 0 && (
                  <span className="bg-cc-primary/10 text-cc-primary text-[10px] rounded-full px-2 py-0.5">
                    Primary
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                <button
                  onClick={() => onEdit(agent)}
                  className="p-1.5 rounded-lg text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
                  title="Edit"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61z" />
                  </svg>
                </button>
                <button
                  onClick={() => onRun(agent)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-cc-primary text-white hover:bg-cc-primary-hover transition-colors cursor-pointer"
                  title="Run agent"
                >
                  Run
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
