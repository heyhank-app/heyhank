import { useState, useEffect, useRef } from "react";
import { api } from "../api.js";

interface CallInfo {
  id: string;
  phone: string;
  status: string;
  prompt: string;
  durationSeconds: number;
  startedAt: number;
  summary?: string | null;
  transcript?: Array<{ speaker: string; text: string; ts: number }>;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  notes?: string;
}

export function TelephonyPage({ embedded }: { embedded?: boolean }) {
  const [phone, setPhone] = useState("");
  const [prompt, setPrompt] = useState("");
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState("");
  // Settings state
  const [telSettings, setTelSettings] = useState<{
    enabled: boolean;
    freeswitch: { eslHost: string; eslPort: number; eslPassword?: string };
    trunks: Array<{ id: string; name: string; provider: string; username?: string; password?: string; server?: string; callerId: string; enabled: boolean }>;
    defaultVoice: string;
    maxCallDurationSeconds?: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; status?: string; error?: string } | null>(null);
  const [showAddTrunk, setShowAddTrunk] = useState(false);
  const [newTrunk, setNewTrunk] = useState({ name: "peoplefone", provider: "peoplefone", username: "", password: "", server: "sip.peoplefone.at", callerId: "", enabled: true });
  const [activeCalls, setActiveCalls] = useState<CallInfo[]>([]);
  const [history, setHistory] = useState<CallInfo[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallInfo | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<Array<{ speaker: string; text: string; ts: number }>>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: "", phone: "", notes: "" });
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editContactData, setEditContactData] = useState({ name: "", phone: "", notes: "" });

  // Load active calls and history
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Load contacts + settings
  useEffect(() => {
    api.getContacts().then((r) => setContacts(r.contacts)).catch(() => {});
    api.getTelephonySettings().then((s) => setTelSettings(s as typeof telSettings)).catch(() => {});
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [liveTranscript]);

  async function loadData() {
    try {
      const [active, hist] = await Promise.all([
        api.getActiveCalls(),
        api.getCallHistory(20),
      ]);
      setActiveCalls(active.calls);
      setHistory(hist.calls);
    } catch { /* silent */ }
  }

  async function handleCall() {
    if (!phone.trim() || !prompt.trim() || calling) return;
    setCalling(true);
    setError("");
    try {
      const result = await api.startCall({ phone: phone.trim(), prompt: prompt.trim() });
      if (result.error) {
        setError(result.error);
      } else {
        setPhone("");
        setPrompt("");
        // Connect to live transcript
        connectTranscript(result.id);
        loadData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start call");
    } finally {
      setCalling(false);
    }
  }

  function connectTranscript(callId: string) {
    if (wsRef.current) wsRef.current.close();
    setLiveTranscript([]);

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/telephony/transcript/${callId}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "transcript" && data.entry) {
          setLiveTranscript((prev) => [...prev, data.entry]);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    wsRef.current = ws;
  }

  async function handleEndCall(callId: string) {
    try {
      await api.endCall(callId);
      loadData();
    } catch { /* silent */ }
  }

  async function addContact() {
    if (!newContact.name.trim() || !newContact.phone.trim()) return;
    try {
      const c = await api.addContact(newContact);
      setContacts((prev) => [...prev, c]);
      setNewContact({ name: "", phone: "", notes: "" });
      setShowAddContact(false);
    } catch { /* silent */ }
  }

  async function removeContact(id: string) {
    try {
      await api.deleteContact(id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch { /* silent */ }
  }

  async function saveContactEdit() {
    if (!editingContactId) return;
    try {
      const updated = await api.updateContact(editingContactId, editContactData);
      setContacts((prev) => prev.map((c) => c.id === editingContactId ? updated : c));
      setEditingContactId(null);
    } catch { /* silent */ }
  }

  async function saveTelSettings(updates: Record<string, unknown>) {
    setSaving(true);
    try {
      await api.updateTelephonySettings(updates);
      const fresh = await api.getTelephonySettings();
      setTelSettings(fresh as typeof telSettings);
    } catch { /* silent */ }
    setSaving(false);
  }

  async function testFsConnection() {
    setTestResult(null);
    const result = await api.testFreeSwitchConnection();
    setTestResult(result);
  }

  async function addTrunk() {
    if (!newTrunk.username || !newTrunk.password || !newTrunk.server) return;
    try {
      await fetch("/api/telephony/trunks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTrunk),
      });
      const fresh = await api.getTelephonySettings();
      setTelSettings(fresh as typeof telSettings);
      setShowAddTrunk(false);
      setNewTrunk({ name: "peoplefone", provider: "peoplefone", username: "", password: "", server: "sip.peoplefone.at", callerId: "", enabled: true });
    } catch { /* silent */ }
  }

  async function removeTrunk(id: string) {
    try {
      await fetch(`/api/telephony/trunks/${encodeURIComponent(id)}`, { method: "DELETE" });
      const fresh = await api.getTelephonySettings();
      setTelSettings(fresh as typeof telSettings);
    } catch { /* silent */ }
  }

  function viewCall(call: CallInfo) {
    setSelectedCall(call);
    if (call.status === "active" || call.status === "dialing" || call.status === "ringing") {
      connectTranscript(call.id);
    } else {
      // Load full call details for history
      api.getCall(call.id).then((full) => {
        setSelectedCall(full);
        setLiveTranscript(full.transcript || []);
      }).catch(() => {});
    }
  }

  return (
    <div className={`h-full overflow-auto ${embedded ? "" : ""}`}>
      <div className="max-w-3xl mx-auto px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-cc-fg">Telephony</h1>
          <p className="text-xs text-cc-muted mt-1">
            Make AI-powered phone calls via FreeSWITCH + Gemini Live.
          </p>
        </div>

        {/* Dialer */}
        <div className="bg-cc-card border border-cc-border rounded-xl p-4 mb-6">
          <h2 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-3">New Call</h2>
          <div className="space-y-3">
            <div>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+43 664 1234567"
                className="w-full px-3 py-2 text-sm bg-cc-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:border-cc-primary"
              />
            </div>
            <div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Task for the AI (e.g. 'Reserve a table for 4 at 7pm on Friday')"
                rows={2}
                className="w-full px-3 py-2 text-sm bg-cc-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:border-cc-primary resize-none"
              />
            </div>
            <button
              onClick={handleCall}
              disabled={!phone.trim() || !prompt.trim() || calling}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-500 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {calling ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Dialing...
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <PhoneIcon className="w-3.5 h-3.5" />
                  Call
                </span>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-cc-error/5 border border-cc-error/20">
            <p className="text-xs text-cc-error">{error}</p>
          </div>
        )}

        {/* Contacts */}
        <div className="bg-cc-card border border-cc-border rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Contacts</h2>
            <button
              onClick={() => setShowAddContact(!showAddContact)}
              className="text-xs text-cc-primary hover:text-cc-primary/80 transition-colors cursor-pointer"
            >
              {showAddContact ? "Cancel" : "+ Add"}
            </button>
          </div>

          {showAddContact && (
            <div className="bg-cc-bg rounded-lg p-3 border border-cc-border space-y-2 mb-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-cc-muted">Name</label>
                  <input type="text" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                    placeholder="e.g. Mama" className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                </div>
                <div>
                  <label className="text-[11px] text-cc-muted">Phone</label>
                  <input type="tel" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                    placeholder="+43..." className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-cc-muted">Notes (optional)</label>
                <input type="text" value={newContact.notes} onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                  placeholder="e.g. Mo-Sa 10-18 Uhr" className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
              </div>
              <button
                onClick={addContact}
                disabled={!newContact.name.trim() || !newContact.phone.trim()}
                className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                Add Contact
              </button>
            </div>
          )}

          {contacts.length === 0 && !showAddContact ? (
            <p className="text-xs text-cc-muted">No contacts yet. Add contacts so Gemini can call them by name.</p>
          ) : (
            <div className="space-y-1.5">
              {contacts.map((c) => (
                <div key={c.id} className="bg-cc-bg rounded-lg px-3 py-2 border border-cc-border">
                  {editingContactId === c.id ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" value={editContactData.name} onChange={(e) => setEditContactData({ ...editContactData, name: e.target.value })}
                          className="px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                        <input type="tel" value={editContactData.phone} onChange={(e) => setEditContactData({ ...editContactData, phone: e.target.value })}
                          className="px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                      </div>
                      <input type="text" value={editContactData.notes} onChange={(e) => setEditContactData({ ...editContactData, notes: e.target.value })}
                        placeholder="Notes" className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                      <div className="flex gap-2">
                        <button onClick={saveContactEdit} className="px-2 py-1 text-[11px] rounded bg-green-600 text-white hover:bg-green-500 cursor-pointer">Save</button>
                        <button onClick={() => setEditingContactId(null)} className="px-2 py-1 text-[11px] rounded bg-cc-hover text-cc-muted hover:text-cc-fg cursor-pointer">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => { setPhone(c.phone); }}
                        className="min-w-0 flex-1 text-left cursor-pointer hover:opacity-80"
                        title="Click to use this number"
                      >
                        <p className="text-xs font-medium text-cc-fg">{c.name}</p>
                        <p className="text-[11px] text-cc-muted">{c.phone}{c.notes ? ` — ${c.notes}` : ""}</p>
                      </button>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <button
                          onClick={() => { setEditingContactId(c.id); setEditContactData({ name: c.name, phone: c.phone, notes: c.notes || "" }); }}
                          className="text-[11px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeContact(c.id)}
                          className="text-[11px] text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Calls */}
        {activeCalls.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-3">Active Calls</h2>
            <div className="space-y-2">
              {activeCalls.map((call) => (
                <div
                  key={call.id}
                  className="bg-cc-card border border-cc-border rounded-lg px-4 py-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <div>
                      <p className="text-sm font-medium text-cc-fg">{call.phone}</p>
                      <p className="text-[11px] text-cc-muted truncate max-w-[200px]">{call.prompt}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-cc-muted">{call.status}</span>
                    <button
                      onClick={() => viewCall(call)}
                      className="text-xs text-cc-primary hover:text-cc-primary/80 transition-colors cursor-pointer"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleEndCall(call.id)}
                      className="text-xs text-red-500 hover:text-red-400 transition-colors cursor-pointer"
                    >
                      Hang up
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live Transcript */}
        {(liveTranscript.length > 0 || selectedCall) && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">
                {selectedCall ? `Transcript — ${selectedCall.phone}` : "Live Transcript"}
              </h2>
              {selectedCall && (
                <button
                  onClick={() => { setSelectedCall(null); setLiveTranscript([]); wsRef.current?.close(); }}
                  className="text-[11px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
                >
                  Close
                </button>
              )}
            </div>
            <div
              ref={transcriptRef}
              className="bg-cc-card border border-cc-border rounded-xl p-3 max-h-[300px] overflow-y-auto space-y-2"
            >
              {liveTranscript.length === 0 && (
                <p className="text-xs text-cc-muted text-center py-4">Waiting for conversation...</p>
              )}
              {liveTranscript.map((entry, i) => (
                <div key={i} className={`flex ${entry.speaker === "ai" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-1.5 text-xs ${
                      entry.speaker === "ai"
                        ? "bg-cc-primary/20 text-cc-fg"
                        : entry.speaker === "system"
                          ? "bg-cc-hover text-cc-muted italic"
                          : "bg-cc-card text-cc-fg border border-cc-border"
                    }`}
                  >
                    <span className="text-[10px] text-cc-muted font-medium">
                      {entry.speaker === "callee" ? "Callee" : entry.speaker === "ai" ? "AI" : "System"}
                    </span>
                    <p className="mt-0.5">{entry.text}</p>
                  </div>
                </div>
              ))}
            </div>
            {selectedCall?.summary && (
              <div className="mt-2 px-3 py-2 bg-cc-hover rounded-lg">
                <p className="text-[11px] text-cc-muted font-medium mb-1">Summary</p>
                <p className="text-xs text-cc-fg">{selectedCall.summary}</p>
              </div>
            )}
          </div>
        )}

        {/* Settings */}
        {telSettings && (
          <details className="bg-cc-card border border-cc-border rounded-xl mb-6 group">
            <summary className="px-4 py-3 cursor-pointer text-xs font-semibold text-cc-muted uppercase tracking-wider flex items-center justify-between select-none">
              <span>Settings</span>
              <svg className="w-3.5 h-3.5 text-cc-muted transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
            </summary>
            <div className="px-4 pb-4 space-y-4">
              {/* Enable/Disable */}
              <button
                type="button"
                onClick={() => saveTelSettings({ enabled: !telSettings.enabled })}
                disabled={saving}
                className="w-full flex items-center justify-between px-3 py-3 min-h-[44px] rounded-lg text-sm bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
              >
                <span>Enable Telephony</span>
                <span className={`inline-flex w-9 h-5 rounded-full transition-colors relative shrink-0 ${telSettings.enabled ? "bg-green-500" : "bg-cc-muted/30"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${telSettings.enabled ? "translate-x-4" : "translate-x-0"}`} />
                </span>
              </button>

              {telSettings.enabled && (
                <>
                  {/* FreeSWITCH Connection */}
                  <div className="bg-cc-bg rounded-lg p-3 space-y-2 border border-cc-border">
                    <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">FreeSWITCH ESL</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-cc-muted">Host</label>
                        <input type="text" value={telSettings.freeswitch.eslHost}
                          onChange={(e) => setTelSettings({ ...telSettings, freeswitch: { ...telSettings.freeswitch, eslHost: e.target.value } })}
                          onBlur={() => saveTelSettings({ freeswitch: telSettings.freeswitch })}
                          className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                      </div>
                      <div>
                        <label className="text-[11px] text-cc-muted">Port</label>
                        <input type="number" value={telSettings.freeswitch.eslPort}
                          onChange={(e) => setTelSettings({ ...telSettings, freeswitch: { ...telSettings.freeswitch, eslPort: parseInt(e.target.value) || 8021 } })}
                          onBlur={() => saveTelSettings({ freeswitch: telSettings.freeswitch })}
                          className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-cc-muted">ESL Password</label>
                      <input type="password" value={telSettings.freeswitch.eslPassword || ""}
                        onChange={(e) => setTelSettings({ ...telSettings, freeswitch: { ...telSettings.freeswitch, eslPassword: e.target.value } })}
                        onBlur={() => saveTelSettings({ freeswitch: telSettings.freeswitch })}
                        placeholder="heyhank_esl_secret"
                        className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={testFsConnection}
                        className="px-3 py-1.5 text-xs rounded bg-cc-primary text-white hover:opacity-90 transition-opacity cursor-pointer">
                        Test Connection
                      </button>
                      {testResult && (
                        <span className={`text-xs ${testResult.connected ? "text-green-500" : "text-red-400"}`}>
                          {testResult.connected ? "Connected" : testResult.error || "Failed"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* SIP Trunks */}
                  <div className="bg-cc-bg rounded-lg p-3 space-y-2 border border-cc-border">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">SIP Trunks</h3>
                      <button onClick={() => setShowAddTrunk(!showAddTrunk)}
                        className="text-xs text-cc-primary hover:text-cc-primary/80 transition-colors cursor-pointer">
                        {showAddTrunk ? "Cancel" : "+ Add Trunk"}
                      </button>
                    </div>
                    {telSettings.trunks.length === 0 && !showAddTrunk && (
                      <p className="text-xs text-cc-muted">No SIP trunks configured.</p>
                    )}
                    {telSettings.trunks.map((trunk) => (
                      <div key={trunk.id} className="flex items-center justify-between bg-cc-hover rounded-lg px-3 py-2">
                        <div>
                          <p className="text-xs font-medium text-cc-fg">{trunk.name} <span className="text-cc-muted">({trunk.provider})</span></p>
                          <p className="text-[11px] text-cc-muted">{trunk.callerId || "No caller ID"}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${trunk.enabled ? "bg-green-500" : "bg-cc-muted"}`} />
                          <button onClick={() => removeTrunk(trunk.id)}
                            className="text-[11px] text-red-400 hover:text-red-300 transition-colors cursor-pointer">Remove</button>
                        </div>
                      </div>
                    ))}
                    {showAddTrunk && (
                      <div className="bg-cc-hover rounded-lg p-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-cc-muted">Name</label>
                            <input type="text" value={newTrunk.name} onChange={(e) => setNewTrunk({ ...newTrunk, name: e.target.value })}
                              className="w-full px-2 py-1.5 text-xs bg-cc-bg border border-cc-border rounded text-cc-fg" />
                          </div>
                          <div>
                            <label className="text-[11px] text-cc-muted">Provider</label>
                            <select value={newTrunk.provider} onChange={(e) => {
                              const p = e.target.value;
                              const servers: Record<string, string> = { peoplefone: "sip.peoplefone.at", easybell: "sip.easybell.de", sipgate: "sipconnect.sipgate.de" };
                              setNewTrunk({ ...newTrunk, provider: p, name: p, server: servers[p] || "" });
                            }} className="w-full px-2 py-1.5 text-xs bg-cc-bg border border-cc-border rounded text-cc-fg">
                              <option value="peoplefone">peoplefone (AT)</option>
                              <option value="easybell">easybell (DE)</option>
                              <option value="sipgate">sipgate (DE)</option>
                              <option value="custom">Custom</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-cc-muted">SIP Server</label>
                          <input type="text" value={newTrunk.server} onChange={(e) => setNewTrunk({ ...newTrunk, server: e.target.value })}
                            className="w-full px-2 py-1.5 text-xs bg-cc-bg border border-cc-border rounded text-cc-fg" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-cc-muted">SIP Username</label>
                            <input type="text" value={newTrunk.username} onChange={(e) => setNewTrunk({ ...newTrunk, username: e.target.value })}
                              className="w-full px-2 py-1.5 text-xs bg-cc-bg border border-cc-border rounded text-cc-fg" />
                          </div>
                          <div>
                            <label className="text-[11px] text-cc-muted">SIP Password</label>
                            <input type="password" value={newTrunk.password} onChange={(e) => setNewTrunk({ ...newTrunk, password: e.target.value })}
                              className="w-full px-2 py-1.5 text-xs bg-cc-bg border border-cc-border rounded text-cc-fg" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-cc-muted">Caller ID (E.164)</label>
                          <input type="text" value={newTrunk.callerId} onChange={(e) => setNewTrunk({ ...newTrunk, callerId: e.target.value })}
                            placeholder="+43..." className="w-full px-2 py-1.5 text-xs bg-cc-bg border border-cc-border rounded text-cc-fg" />
                        </div>
                        <button onClick={addTrunk} disabled={!newTrunk.username || !newTrunk.password || !newTrunk.server}
                          className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-500 transition-colors cursor-pointer disabled:opacity-50">
                          Add Trunk
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Voice & Limits */}
                  <div className="bg-cc-bg rounded-lg p-3 space-y-2 border border-cc-border">
                    <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Defaults</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-cc-muted">Default Voice</label>
                        <select value={telSettings.defaultVoice || "Kore"} onChange={(e) => saveTelSettings({ defaultVoice: e.target.value })}
                          className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg">
                          <option value="Kore">Kore (male)</option>
                          <option value="Puck">Puck (male)</option>
                          <option value="Charon">Charon (male)</option>
                          <option value="Aoede">Aoede (female)</option>
                          <option value="Fenrir">Fenrir (male)</option>
                          <option value="Leda">Leda (female)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-cc-muted">Max Call Duration (sec)</label>
                        <input type="number" value={telSettings.maxCallDurationSeconds || 600}
                          onChange={(e) => saveTelSettings({ maxCallDurationSeconds: parseInt(e.target.value) || 600 })}
                          className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </details>
        )}

        {/* Call History */}
        <div>
          <h2 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-3">History</h2>
          {history.length === 0 ? (
            <p className="text-xs text-cc-muted">No calls yet.</p>
          ) : (
            <div className="space-y-1.5">
              {history.map((call) => (
                <button
                  key={call.id}
                  onClick={() => viewCall(call)}
                  className="w-full text-left bg-cc-card border border-cc-border rounded-lg px-4 py-2.5 hover:border-cc-primary/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        call.status === "ended" ? "bg-cc-muted" : call.status === "failed" ? "bg-red-500" : "bg-green-500"
                      }`} />
                      <span className="text-sm text-cc-fg">{call.phone}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {call.durationSeconds > 0 && (
                        <span className="text-[11px] text-cc-muted">{formatDuration(call.durationSeconds)}</span>
                      )}
                      <span className="text-[11px] text-cc-muted">{formatTime(call.startedAt)}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-cc-muted truncate mt-0.5">{call.prompt}</p>
                  {call.summary && (
                    <p className="text-[11px] text-cc-fg/70 truncate mt-0.5">{call.summary}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
