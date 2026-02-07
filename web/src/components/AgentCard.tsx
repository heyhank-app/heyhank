import { useStore } from "../store.js";
import type { AgentInfo } from "../types.js";

const STATUS_COLORS = {
  running: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]",
  idle: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.3)]",
  exited: "bg-gray-600",
};

const TYPE_COLORS: Record<string, string> = {
  "general-purpose": "text-blue-300 bg-blue-500/10 ring-1 ring-blue-500/20",
  Bash: "text-emerald-300 bg-emerald-500/10 ring-1 ring-emerald-500/20",
  Explore: "text-violet-300 bg-violet-500/10 ring-1 ring-violet-500/20",
  Plan: "text-amber-300 bg-amber-500/10 ring-1 ring-amber-500/20",
};

export function AgentCard({ agent }: { agent: AgentInfo }) {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const selectAgent = useStore((s) => s.selectAgent);
  const pendingApprovals = useStore((s) => s.pendingApprovals);

  const isSelected = selectedAgent === agent.name;
  const hasApproval = Array.from(pendingApprovals.values()).some(
    (a) => a.agent === agent.name
  );

  const typeStyle = TYPE_COLORS[agent.type] || "text-gray-400 bg-gray-500/10 ring-1 ring-gray-500/20";

  return (
    <button
      onClick={() => selectAgent(agent.name)}
      className={`w-full px-3 py-2.5 text-left rounded-lg transition-all duration-150 cursor-pointer group ${
        isSelected
          ? "bg-gray-800/80 ring-1 ring-indigo-500/25"
          : "hover:bg-gray-800/40"
      } ${agent.status === "exited" ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="relative flex shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${STATUS_COLORS[agent.status]}`}
            title={agent.status}
          />
          {agent.status === "running" && (
            <span className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400/60 animate-ping" />
          )}
        </span>
        <span className="text-[13px] font-medium truncate flex-1 text-gray-200 group-hover:text-white transition-colors">
          {agent.name}
        </span>
        {hasApproval && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-orange-500/15 ring-1 ring-orange-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            <span className="text-[9px] font-semibold text-orange-300 uppercase tracking-wide">Action</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1.5 ml-[18px]">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${typeStyle}`}
        >
          {agent.type}
        </span>
        {agent.model && (
          <span className="text-[10px] text-gray-600 font-mono">{agent.model}</span>
        )}
      </div>
    </button>
  );
}
