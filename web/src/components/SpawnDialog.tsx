import { useState } from "react";
import { api } from "../api.js";

const AGENT_TYPES = ["general-purpose", "Bash", "Explore", "Plan"];
const MODELS = ["sonnet", "opus", "haiku"];
const PERMISSIONS = ["full", "edit", "plan", "ask"];

export function SpawnDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("general-purpose");
  const [model, setModel] = useState("sonnet");
  const [permissions, setPermissions] = useState("full");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSpawn() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setLoading(true);
    setError("");

    try {
      await api.spawnAgent({
        name: name.trim(),
        type,
        model,
        permissions,
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
      });
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg p-0 bg-gray-900 rounded-2xl border border-gray-700/60 shadow-2xl shadow-black/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-blue-400">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-gray-100">Spawn Agent</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-all cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Agent Name */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="worker-1"
              autoFocus
              className="w-full px-3.5 py-2.5 text-sm bg-gray-800/60 border border-gray-700/60 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 text-gray-100 placeholder-gray-600 transition-all"
            />
          </div>

          {/* Type + Model + Permissions row */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-gray-800/60 border border-gray-700/60 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 text-gray-100 transition-all cursor-pointer"
              >
                {AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-gray-800/60 border border-gray-700/60 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 text-gray-100 transition-all cursor-pointer"
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Permissions</label>
              <select
                value={permissions}
                onChange={(e) => setPermissions(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-gray-800/60 border border-gray-700/60 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 text-gray-100 transition-all cursor-pointer"
              >
                {PERMISSIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* API Key + Base URL */}
          <div className="rounded-xl bg-gray-800/30 border border-gray-700/40 p-4 space-y-3">
            <label className="text-xs font-medium text-gray-400">API Configuration <span className="text-gray-600">(optional, inherits from session)</span></label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API Key (override session key)"
              className="w-full px-2.5 py-1.5 text-xs bg-gray-900/60 border border-gray-700/50 rounded-md font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-all"
            />
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="Base URL (override session URL)"
              className="w-full px-2.5 py-1.5 text-xs bg-gray-900/60 border border-gray-700/50 rounded-md font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-all"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-red-400 shrink-0">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
              </svg>
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800 bg-gray-900/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 rounded-lg hover:bg-gray-800 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSpawn}
            disabled={loading}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20 cursor-pointer"
          >
            {loading ? "Spawning..." : "Spawn"}
          </button>
        </div>
      </div>
    </div>
  );
}
