import { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import type {
  CostSummary,
  CostRecord,
  KillSwitchState,
  SharedContextFile,
  PlatformMessage,
  LLMProvider,
} from "../api.js";

// ─── Cost Dashboard Section ──────────────────────────────────────────────────

function CostDashboard() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [records, setRecords] = useState<CostRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        api.getCostSummary(),
        api.getCosts(20),
      ]);
      setSummary(s);
      setRecords(r);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <div className="text-cc-text-secondary text-sm">Loading costs...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-cc-text-primary">Cost Tracking</h3>
        <button onClick={refresh} className="text-xs text-cc-text-secondary hover:text-cc-text-primary">
          Refresh
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Cost" value={`$${summary.allTimeCost.toFixed(4)}`} />
          <StatCard label="Tokens In" value={formatNumber(summary.allTimeTokensIn)} />
          <StatCard label="Tokens Out" value={formatNumber(summary.allTimeTokensOut)} />
          <StatCard label="Records" value={String(summary.totalRecords)} />
        </div>
      )}

      {records.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-cc-text-secondary border-b border-cc-border">
                <th className="pb-2 text-left font-medium">Agent</th>
                <th className="pb-2 text-left font-medium">Model</th>
                <th className="pb-2 text-right font-medium">Tokens</th>
                <th className="pb-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.agentId} className="border-b border-cc-border/50">
                  <td className="py-1.5 text-cc-text-primary">{r.agentName}</td>
                  <td className="py-1.5 text-cc-text-secondary">{r.model}</td>
                  <td className="py-1.5 text-right text-cc-text-secondary">
                    {formatNumber(r.tokensIn + r.tokensOut)}
                  </td>
                  <td className="py-1.5 text-right text-cc-text-primary">
                    ${r.estimatedCost.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Kill Switch Section ─────────────────────────────────────────────────────

function KillSwitchPanel() {
  const [state, setState] = useState<KillSwitchState>({ killed: false });
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getKillSwitch().then(setState).catch(() => {});
  }, []);

  const activate = async () => {
    setLoading(true);
    try {
      const s = await api.activateKillSwitch(reason || "Manual activation from dashboard");
      setState(s);
      setReason("");
    } finally {
      setLoading(false);
    }
  };

  const deactivate = async () => {
    setLoading(true);
    try {
      const s = await api.deactivateKillSwitch();
      setState(s);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-cc-text-primary">Kill Switch</h3>
      <div className={`rounded-lg p-3 text-sm ${state.killed ? "bg-red-500/10 border border-red-500/30" : "bg-green-500/10 border border-green-500/30"}`}>
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${state.killed ? "bg-red-500" : "bg-green-500"}`} />
          <span className={state.killed ? "text-red-400 font-medium" : "text-green-400"}>
            {state.killed ? "KILLED — All agents stopped" : "Active — Agents running normally"}
          </span>
        </div>
        {state.killed && state.reason && (
          <p className="mt-1 text-xs text-red-300/70">Reason: {state.reason}</p>
        )}
        {state.killed && state.activatedAt && (
          <p className="mt-0.5 text-xs text-red-300/50">Since: {new Date(state.activatedAt).toLocaleString()}</p>
        )}
      </div>

      {state.killed ? (
        <button
          onClick={deactivate}
          disabled={loading}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          {loading ? "Deactivating..." : "Deactivate Kill Switch"}
        </button>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="flex-1 rounded-lg border border-cc-border bg-cc-bg-secondary px-3 py-1.5 text-sm text-cc-text-primary"
          />
          <button
            onClick={activate}
            disabled={loading}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {loading ? "..." : "KILL"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Shared Context Section ──────────────────────────────────────────────────

function SharedContextPanel() {
  const [files, setFiles] = useState<SharedContextFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api.listSharedContext().then(setFiles).catch(() => {});
  }, []);

  const selectFile = async (filename: string) => {
    try {
      const file = await api.getSharedContext(filename);
      setSelected(filename);
      setContent(file.content);
      setEditing(false);
    } catch {
      // ignore
    }
  };

  const save = async () => {
    if (!selected) return;
    try {
      await api.writeSharedContext(selected, content);
      setEditing(false);
      const updated = await api.listSharedContext();
      setFiles(updated);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-cc-text-primary">Shared Context</h3>
      <div className="flex flex-wrap gap-2">
        {files.map((f) => (
          <button
            key={f.filename}
            onClick={() => selectFile(f.filename)}
            className={`rounded-md px-2.5 py-1 text-xs ${selected === f.filename ? "bg-cc-accent text-white" : "bg-cc-bg-secondary text-cc-text-secondary hover:text-cc-text-primary"}`}
          >
            {f.filename}
          </button>
        ))}
      </div>

      {selected && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-cc-text-secondary">{selected}</span>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button onClick={save} className="text-xs text-green-400 hover:text-green-300">Save</button>
                  <button onClick={() => setEditing(false)} className="text-xs text-cc-text-secondary hover:text-cc-text-primary">Cancel</button>
                </>
              ) : (
                <button onClick={() => setEditing(true)} className="text-xs text-cc-text-secondary hover:text-cc-text-primary">Edit</button>
              )}
            </div>
          </div>
          {editing ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className="w-full rounded-lg border border-cc-border bg-cc-bg-secondary p-3 font-mono text-xs text-cc-text-primary"
            />
          ) : (
            <pre className="max-h-64 overflow-auto rounded-lg bg-cc-bg-secondary p-3 text-xs text-cc-text-secondary">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Messages Section ────────────────────────────────────────────────────────

function MessagesPanel() {
  const [messages, setMessages] = useState<PlatformMessage[]>([]);

  useEffect(() => {
    api.listMessages({ limit: 20 }).then(setMessages).catch(() => {});
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-cc-text-primary">Agent Messages</h3>
        <span className="text-xs text-cc-text-secondary">{messages.length} messages</span>
      </div>

      {messages.length === 0 ? (
        <p className="text-xs text-cc-text-secondary">No messages yet.</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-auto">
          {messages.map((msg) => (
            <div key={msg.id} className="rounded-lg bg-cc-bg-secondary p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-cc-text-primary">
                  {msg.fromName || msg.from} → {msg.to || "broadcast"}
                </span>
                <span className="text-cc-text-secondary">
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <span className={`inline-block mt-1 rounded px-1.5 py-0.5 text-[10px] ${
                msg.type === "task" ? "bg-blue-500/20 text-blue-400" :
                msg.type === "result" ? "bg-green-500/20 text-green-400" :
                msg.type === "interrupt" ? "bg-red-500/20 text-red-400" :
                "bg-cc-bg-tertiary text-cc-text-secondary"
              }`}>
                {msg.type}
              </span>
              <p className="mt-1 text-cc-text-secondary line-clamp-2">{msg.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LLM Providers Section ───────────────────────────────────────────────────

function ProvidersPanel() {
  const [providers, setProviders] = useState<LLMProvider[]>([]);

  useEffect(() => {
    api.getLLMProviders().then((d) => setProviders(d.providers)).catch(() => {});
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-cc-text-primary">LLM Providers</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {providers.map((p) => (
          <div key={p.name} className="flex items-center gap-2 rounded-lg bg-cc-bg-secondary p-2.5">
            <span className={`inline-block h-2 w-2 rounded-full ${
              p.status === "available" || p.status === "configured" ? "bg-green-500" :
              p.status === "needs_api_key" ? "bg-yellow-500" : "bg-red-500"
            }`} />
            <div className="flex-1">
              <span className="text-xs font-medium text-cc-text-primary capitalize">{p.name}</span>
              <span className="ml-2 text-[10px] text-cc-text-secondary">{p.status}</span>
            </div>
            {p.models && p.models.length > 0 && (
              <span className="text-[10px] text-cc-text-secondary">{p.models.length} models</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-cc-bg-secondary p-3">
      <div className="text-[10px] uppercase tracking-wider text-cc-text-secondary">{label}</div>
      <div className="mt-1 text-lg font-semibold text-cc-text-primary">{value}</div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function PlatformDashboard() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div>
        <h1 className="text-lg font-semibold text-cc-text-primary">HeyHank Dashboard</h1>
        <p className="text-xs text-cc-text-secondary">Multi-Agent Platform</p>
      </div>

      <KillSwitchPanel />
      <CostDashboard />
      <ProvidersPanel />
      <MessagesPanel />
      <SharedContextPanel />
    </div>
  );
}
