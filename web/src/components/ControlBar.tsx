import { useStore } from "../store.js";
import { api } from "../api.js";
import { useState } from "react";

export function ControlBar() {
  const connected = useStore((s) => s.connected);
  const session = useStore((s) => s.session);
  const agents = useStore((s) => s.agents);
  const [shutting, setShutting] = useState(false);

  const agentCount = agents.size;
  const runningCount = Array.from(agents.values()).filter(
    (a) => a.status !== "exited"
  ).length;

  async function handleShutdownAll() {
    if (!confirm("Shutdown all agents and end session?")) return;
    setShutting(true);
    try {
      await api.shutdownSession();
    } catch (e: any) {
      alert(e.message);
    }
    setShutting(false);
  }

  return (
    <header className="relative shrink-0">
      <div className="flex items-center justify-between px-5 py-3 bg-gray-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-wider text-gray-200 uppercase">
            Claude Code Controller
          </h1>
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ring-2 ${
                connected
                  ? "bg-emerald-400 ring-emerald-400/20"
                  : "bg-red-400 ring-red-400/20"
              }`}
              title={connected ? "Connected" : "Disconnected"}
            />
            <span className="text-[10px] text-gray-500 font-medium">
              {connected ? "Live" : "Offline"}
            </span>
          </div>
        </div>

        {session?.initialized && (
          <div className="flex items-center gap-5 text-xs text-gray-400">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">Team</span>
              <span className="text-gray-200 font-medium">{session.teamName}</span>
            </div>
            <div className="h-3 w-px bg-gray-700/50" />
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">Agents</span>
              <span className="text-gray-200 font-medium tabular-nums">{runningCount}<span className="text-gray-600">/</span>{agentCount}</span>
            </div>
            <div className="h-3 w-px bg-gray-700/50" />
            <button
              onClick={handleShutdownAll}
              disabled={shutting}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-800 text-gray-400 border border-gray-700/50 hover:bg-red-950/50 hover:text-red-300 hover:border-red-800/50 disabled:opacity-40 transition-all duration-200 cursor-pointer"
            >
              {shutting ? "Shutting down..." : "Shutdown All"}
            </button>
          </div>
        )}
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent" />
    </header>
  );
}
