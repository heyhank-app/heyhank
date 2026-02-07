import { useState } from "react";
import { useStore } from "../store.js";
import { AgentCard } from "./AgentCard.js";
import { SpawnDialog } from "./SpawnDialog.js";

export function Sidebar() {
  const [showSpawn, setShowSpawn] = useState(false);
  const agents = useStore((s) => s.agents);

  const sorted = Array.from(agents.values()).sort((a, b) => {
    if (a.status === "exited" && b.status !== "exited") return 1;
    if (a.status !== "exited" && b.status === "exited") return -1;
    return b.spawnedAt - a.spawnedAt;
  });

  return (
    <aside className="w-72 bg-gray-900/50 backdrop-blur-sm flex flex-col shrink-0">
      <div className="p-3">
        <button
          onClick={() => setShowSpawn(true)}
          className="w-full py-2.5 text-sm font-medium rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white shadow-lg shadow-indigo-500/10 transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98]"
        >
          <span className="text-base leading-none font-light">+</span> Spawn Agent
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Agents</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {sorted.length === 0 ? (
          <p className="px-3 py-8 text-xs text-gray-600 text-center leading-relaxed">
            No agents yet.<br />Spawn one to get started.
          </p>
        ) : (
          sorted.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))
        )}
      </div>

      {showSpawn && <SpawnDialog onClose={() => setShowSpawn(false)} />}
    </aside>
  );
}
