import { useState, useEffect, useCallback } from "react";
import { api, type FederationNodeStatus, type FederationRemoteSession } from "../api.js";

export function FederationSettings() {
  const [identity, setIdentity] = useState<{ nodeId: string; name: string } | null>(null);
  const [nodeName, setNodeName] = useState("");
  const [nodes, setNodes] = useState<FederationNodeStatus[]>([]);
  const [remoteSessions, setRemoteSessions] = useState<FederationRemoteSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Add node form
  const [addUrl, setAddUrl] = useState("");
  const [addSecret, setAddSecret] = useState("");
  const [addName, setAddName] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [identityRes, nodesRes, sessionsRes] = await Promise.all([
        api.getFederationIdentity(),
        api.getFederationNodes(),
        api.getFederationRemoteSessions(),
      ]);
      setIdentity(identityRes);
      setNodeName(identityRes.name);
      setNodes(nodesRes.nodes);
      setRemoteSessions(sessionsRes.sessions);
    } catch {
      // endpoints may not exist yet on older servers
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 10s to update connection status
  useEffect(() => {
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const showMessage = (msg: string, isError = false) => {
    if (isError) { setError(msg); setSuccess(""); }
    else { setSuccess(msg); setError(""); }
    setTimeout(() => { setError(""); setSuccess(""); }, 4000);
  };

  const handleSaveName = async () => {
    if (!nodeName.trim()) return;
    setSaving(true);
    try {
      await api.updateFederationIdentity(nodeName.trim());
      showMessage("Node name saved");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to save", true);
    }
    setSaving(false);
  };

  const handleAddNode = async () => {
    if (!addUrl.trim() || !addSecret.trim()) {
      showMessage("URL and shared secret are required", true);
      return;
    }
    setSaving(true);
    try {
      await api.addFederationNode({ url: addUrl.trim(), secret: addSecret.trim(), name: addName.trim() });
      setAddUrl("");
      setAddSecret("");
      setAddName("");
      showMessage("Node added, connecting...");
      setTimeout(refresh, 2000);
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to add node", true);
    }
    setSaving(false);
  };

  const handleRemoveNode = async (id: string) => {
    try {
      await api.removeFederationNode(id);
      showMessage("Node removed");
      refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to remove", true);
    }
  };

  const handleTestNode = async (id: string) => {
    try {
      const result = await api.testFederationNode(id);
      showMessage(result.connected ? "Connection OK" : "Not connected");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Test failed", true);
    }
  };

  if (loading) {
    return <div className="text-sm text-cc-muted">Loading federation...</div>;
  }

  return (
    <div className="space-y-5">
      {/* Status messages */}
      {error && (
        <div className="text-sm text-cc-error bg-cc-error/5 border border-cc-error/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-cc-success bg-cc-success/5 border border-cc-success/20 rounded-lg px-3 py-2">
          {success}
        </div>
      )}

      {/* This Node */}
      <div>
        <h4 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-2">This Node</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={nodeName}
            onChange={(e) => setNodeName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
            placeholder="Node name"
            className="flex-1 px-3 py-2 text-sm rounded-lg bg-cc-hover border border-cc-border text-cc-fg outline-none focus:border-cc-primary/50"
          />
          <button
            onClick={handleSaveName}
            disabled={saving}
            className="px-3 py-2 text-sm rounded-lg bg-cc-hover border border-cc-border text-cc-fg hover:bg-cc-active transition-colors cursor-pointer disabled:opacity-50"
          >
            Save
          </button>
        </div>
        {identity && (
          <p className="text-[10px] text-cc-muted/60 font-mono mt-1 break-all">
            ID: {identity.nodeId}
          </p>
        )}
      </div>

      {/* Add Node */}
      <div>
        <h4 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-2">Add Node</h4>
        <p className="text-xs text-cc-muted mb-2">
          Enter the URL and shared secret of a remote HeyHank instance.
        </p>
        <div className="space-y-2">
          <input
            type="url"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            placeholder="https://other-hank.example.com"
            className="w-full px-3 py-2 text-sm rounded-lg bg-cc-hover border border-cc-border text-cc-fg outline-none focus:border-cc-primary/50"
          />
          <div className="flex gap-2">
            <input
              type="password"
              value={addSecret}
              onChange={(e) => setAddSecret(e.target.value)}
              placeholder="Shared secret"
              className="flex-1 px-3 py-2 text-sm rounded-lg bg-cc-hover border border-cc-border text-cc-fg outline-none focus:border-cc-primary/50"
            />
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Name (optional)"
              className="flex-1 px-3 py-2 text-sm rounded-lg bg-cc-hover border border-cc-border text-cc-fg outline-none focus:border-cc-primary/50"
            />
          </div>
          <button
            onClick={handleAddNode}
            disabled={saving}
            className="w-full px-3 py-2.5 text-sm font-medium rounded-lg bg-cc-primary/10 border border-cc-primary/30 text-cc-primary hover:bg-cc-primary/15 transition-colors cursor-pointer disabled:opacity-50"
          >
            Connect Node
          </button>
        </div>
      </div>

      {/* Connected Nodes */}
      <div>
        <h4 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-2">
          Connected Nodes ({nodes.length})
        </h4>
        {nodes.length === 0 ? (
          <p className="text-xs text-cc-muted/50">No nodes configured.</p>
        ) : (
          <div className="space-y-2">
            {nodes.map((n) => (
              <div key={n.id} className="border border-cc-border/60 rounded-lg p-3 bg-cc-card/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-cc-fg flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        n.connected
                          ? "bg-cc-success shadow-[0_0_6px_rgba(74,222,128,0.4)]"
                          : "bg-cc-error/60"
                      }`}
                    />
                    {n.remoteName || n.name || "Unknown"}
                  </span>
                  <span className="text-[10px] text-cc-muted">
                    {n.connected ? "Connected" : "Offline"} · {n.sessionCount} sessions
                  </span>
                </div>
                <p className="text-[10px] text-cc-muted/60 break-all mb-2">{n.url}</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleTestNode(n.id)}
                    className="px-2 py-1 text-[11px] rounded bg-cc-hover border border-cc-border text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => handleRemoveNode(n.id)}
                    className="px-2 py-1 text-[11px] rounded bg-cc-hover border border-cc-error/20 text-cc-error hover:bg-cc-error/5 transition-colors cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Remote Sessions */}
      {remoteSessions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-2">
            Remote Sessions ({remoteSessions.length})
          </h4>
          <div className="space-y-1.5">
            {remoteSessions.map((s) => (
              <div
                key={`${s.nodeId}:${s.sessionId}`}
                className="border border-cc-border/40 rounded-lg px-3 py-2 bg-cc-card/30"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-cc-fg truncate">
                    {s.name || s.sessionId.slice(0, 8)}
                  </span>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-cc-primary/15 text-cc-primary leading-none shrink-0">
                    {s.nodeName}
                  </span>
                </div>
                <p className="text-[10px] text-cc-muted/60 truncate mt-0.5">
                  {s.model || ""} · {s.cwd || s.sessionId}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
