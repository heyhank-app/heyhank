import { useState } from "react";
import { api } from "../api.js";

export function InitSession() {
  const [teamName, setTeamName] = useState("");
  const [cwd, setCwd] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleInit() {
    setLoading(true);
    setError("");
    try {
      await api.initSession({
        teamName: teamName || undefined,
        cwd: cwd || undefined,
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
      });
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-md p-8 bg-gray-900/80 rounded-2xl border border-gray-700/50 shadow-2xl shadow-blue-500/5 backdrop-blur-sm">
        {/* Icon + Title */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/20 flex items-center justify-center mb-5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7 text-blue-400">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-100 tracking-tight">Claude Code Controller</h1>
          <p className="text-sm text-gray-500 mt-1.5">Configure and initialize your agent session</p>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              API Key <span className="text-gray-600">(optional)</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-3.5 py-2.5 text-sm bg-gray-800/60 border border-gray-700/60 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 text-gray-100 font-mono placeholder-gray-600 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Base URL <span className="text-gray-600">(optional)</span>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com"
              className="w-full px-3.5 py-2.5 text-sm bg-gray-800/60 border border-gray-700/60 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 text-gray-100 font-mono placeholder-gray-600 transition-all"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Team Name <span className="text-gray-600">(optional)</span>
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="my-project"
                className="w-full px-3.5 py-2.5 text-sm bg-gray-800/60 border border-gray-700/60 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 text-gray-100 placeholder-gray-600 transition-all"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Working Directory <span className="text-gray-600">(optional)</span>
              </label>
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="w-full px-3.5 py-2.5 text-sm bg-gray-800/60 border border-gray-700/60 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 text-gray-100 font-mono placeholder-gray-600 transition-all"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-red-400 shrink-0">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
              </svg>
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          <button
            onClick={handleInit}
            disabled={loading}
            className="w-full py-2.5 text-sm font-medium rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20 cursor-pointer"
          >
            {loading ? "Initializing..." : "Initialize Session"}
          </button>
        </div>
      </div>
    </div>
  );
}
