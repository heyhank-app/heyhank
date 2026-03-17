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
    <div className="relative mb-6 rounded-xl border border-cc-border bg-cc-card overflow-hidden">
      {/* Decorative top accent — a thin warm gradient strip */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background: "linear-gradient(90deg, transparent 0%, var(--color-cc-primary) 30%, var(--color-cc-primary) 70%, transparent 100%)",
          opacity: 0.5,
        }}
      />

      <div className="px-5 pt-5 pb-2">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <LinearLogo className="w-4 h-4 text-cc-fg opacity-70" />
            <h3 className="text-sm font-semibold tracking-tight text-cc-fg">Linear Agents</h3>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onManageCredentials}
              className="text-[11px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
            >
              Manage OAuth
            </button>
            <button
              onClick={onAddNew}
              className="text-[11px] font-medium text-cc-primary hover:text-cc-primary-hover transition-colors cursor-pointer"
            >
              + Add Linear Agent
            </button>
          </div>
        </div>
      </div>

      {/* Agent list or empty state */}
      {agents.length === 0 ? (
        <div className="px-5 pb-5 pt-3">
          <p className="text-xs text-cc-muted">
            No Linear agents yet. Create one to respond to @mentions in Linear.
          </p>
        </div>
      ) : (
        <div className="px-5 pb-4 pt-1">
          <div className="divide-y divide-cc-border/40">
            {agents.map((agent, index) => (
              <div
                key={agent.id}
                className="group flex items-center justify-between py-2.5 first:pt-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[13px] font-medium text-cc-fg truncate">{agent.name}</span>
                  <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-cc-hover text-cc-muted leading-none">
                    {agent.backendType === "codex" ? "Codex" : "Claude"}
                  </span>
                  {index === 0 && (
                    <span className="bg-cc-primary/8 text-cc-primary text-[10px] font-medium rounded-md px-1.5 py-0.5 leading-none">
                      Primary
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onEdit(agent)}
                    className="p-1.5 rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
                    title="Edit"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onRun(agent)}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-cc-primary text-white hover:bg-cc-primary-hover transition-colors cursor-pointer"
                    title="Run agent"
                  >
                    Run
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
