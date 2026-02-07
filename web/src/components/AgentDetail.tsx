import { useStore } from "../store.js";
import { api } from "../api.js";
import { MessageFeed } from "./MessageFeed.js";
import { MessageInput } from "./MessageInput.js";
import { ApprovalBanner } from "./ApprovalBanner.js";

const STATUS_CONFIG = {
  running: {
    color: "bg-emerald-400/15 text-emerald-400 ring-emerald-400/30",
    dot: "bg-emerald-400",
  },
  idle: {
    color: "bg-amber-400/15 text-amber-400 ring-amber-400/30",
    dot: "bg-amber-400",
  },
  exited: {
    color: "bg-red-400/15 text-red-400 ring-red-400/30",
    dot: "bg-red-400",
  },
};

export function AgentDetail() {
  const selectedAgent = useStore((s) => s.selectedAgent)!;
  const agents = useStore((s) => s.agents);
  const pendingApprovals = useStore((s) => s.pendingApprovals);
  const selectAgent = useStore((s) => s.selectAgent);

  const agent = agents.get(selectedAgent);
  if (!agent) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Agent not found
      </div>
    );
  }

  const approvals = Array.from(pendingApprovals.values()).filter(
    (a) => a.agent === selectedAgent
  );

  const statusCfg = STATUS_CONFIG[agent.status];

  async function handleShutdown() {
    if (!confirm(`Shutdown agent "${agent!.name}"?`)) return;
    await api.shutdownAgent(agent!.name);
  }

  async function handleKill() {
    if (!confirm(`Force kill agent "${agent!.name}"?`)) return;
    await api.killAgent(agent!.name);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-950/60 backdrop-blur-sm border-b border-gray-800/80 shadow-[0_1px_3px_rgba(0,0,0,0.3)] shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => selectAgent(null)}
            className="md:hidden flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M19 12H5" />
              <path d="M12 19L5 12L12 5" />
            </svg>
          </button>
          <h2 className="text-sm font-semibold text-gray-100 tracking-tight">{agent.name}</h2>
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset ${statusCfg.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot} ${agent.status === "running" ? "animate-pulse" : ""}`} />
            {agent.status}
          </span>
          <span className="text-[10px] text-gray-500 font-mono">
            {agent.type}
            {agent.model ? ` / ${agent.model}` : ""}
            {agent.pid ? ` / PID ${agent.pid}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {agent.status !== "exited" && (
            <>
              <button
                onClick={handleShutdown}
                className="group flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg text-amber-400/80 hover:text-amber-300 hover:bg-amber-400/10 transition-colors"
                title="Shutdown agent"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64" />
                  <line x1="12" y1="2" x2="12" y2="12" />
                </svg>
                <span className="hidden sm:inline">Shutdown</span>
              </button>
              <button
                onClick={handleKill}
                className="group flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg text-red-400/80 hover:text-red-300 hover:bg-red-400/10 transition-colors"
                title="Force kill agent"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                <span className="hidden sm:inline">Kill</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Approvals */}
      {approvals.map((a) => (
        <ApprovalBanner key={a.id} approval={a} />
      ))}

      {/* Messages */}
      <MessageFeed agentName={selectedAgent} />

      {/* Input */}
      {agent.status !== "exited" && (
        <MessageInput agentName={selectedAgent} />
      )}
    </div>
  );
}
