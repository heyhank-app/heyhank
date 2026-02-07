import { useStore } from "../store.js";

const STATUS_COLORS = {
  running: "border-green-500/20 bg-gradient-to-br from-green-500/5 to-green-500/0",
  idle: "border-yellow-500/20 bg-gradient-to-br from-yellow-500/5 to-yellow-500/0",
  exited: "border-red-500/20 bg-gradient-to-br from-red-500/5 to-red-500/0",
};

const STATUS_DOT = {
  running: "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]",
  idle: "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]",
  exited: "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.4)]",
};

const STATUS_BAR = {
  running: "bg-green-500",
  idle: "bg-yellow-500",
  exited: "bg-red-500/60",
};

export function Dashboard() {
  const agents = useStore((s) => s.agents);
  const messages = useStore((s) => s.messages);
  const selectAgent = useStore((s) => s.selectAgent);

  const list = Array.from(agents.values());

  if (list.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-800/50 border border-gray-700/50 flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-gray-600">
              <path d="M12 4.75L19.25 9L12 13.25L4.75 9L12 4.75Z" />
              <path d="M4.75 14L12 18.25L19.25 14" />
            </svg>
          </div>
          <p className="text-base font-medium text-gray-400 mb-1">No agents running</p>
          <p className="text-sm text-gray-600">Click "Spawn Agent" in the sidebar to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Agents Overview
        </h2>
        <div className="flex-1 h-px bg-gray-800" />
        <span className="text-xs text-gray-600 tabular-nums">{list.length} active</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((agent) => {
          const agentMsgs = messages.get(agent.name) || [];
          const lastMsg = agentMsgs.filter((m) => !m.isSystem).at(-1);

          return (
            <button
              key={agent.name}
              onClick={() => selectAgent(agent.name)}
              className={`relative overflow-hidden p-4 rounded-xl border text-left hover:border-gray-600 hover:bg-gray-800/40 transition-all group cursor-pointer ${STATUS_COLORS[agent.status]}`}
            >
              {/* Left accent bar */}
              <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${STATUS_BAR[agent.status]}`} />

              <div className="flex items-center gap-2.5 mb-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[agent.status]}`} />
                <span className="font-medium text-sm text-gray-200 group-hover:text-white transition-colors">{agent.name}</span>
                <span className="text-[10px] text-gray-600 ml-auto px-1.5 py-0.5 rounded bg-gray-800/60 border border-gray-700/40">
                  {agent.type}
                </span>
              </div>
              {lastMsg ? (
                <p className="text-xs text-gray-400 truncate font-mono leading-relaxed">
                  {lastMsg.text.slice(0, 100)}
                </p>
              ) : (
                <p className="text-xs text-gray-600 italic">No messages yet</p>
              )}
              <p className="text-[10px] text-gray-600 mt-3 tabular-nums">
                {agentMsgs.length} message{agentMsgs.length !== 1 ? "s" : ""}
                {agent.pid ? ` / PID ${agent.pid}` : ""}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
