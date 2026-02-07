import { useEffect } from "react";
import { connect, disconnect } from "./ws.js";
import { useStore } from "./store.js";
import { ControlBar } from "./components/ControlBar.js";
import { Sidebar } from "./components/Sidebar.js";
import { Dashboard } from "./components/Dashboard.js";
import { AgentDetail } from "./components/AgentDetail.js";
import { InitSession } from "./components/InitSession.js";

export default function App() {
  const session = useStore((s) => s.session);
  const selectedAgent = useStore((s) => s.selectedAgent);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 antialiased">
      <ControlBar />
      {!session?.initialized ? (
        <InitSession />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="w-px bg-gradient-to-b from-indigo-500/20 via-gray-800 to-gray-900 shrink-0" />
          <main className="flex-1 overflow-hidden bg-gray-950">
            {selectedAgent ? <AgentDetail /> : <Dashboard />}
          </main>
        </div>
      )}
    </div>
  );
}
