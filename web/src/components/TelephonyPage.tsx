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

interface CallFlowNode {
  id: string;
  type: "start" | "say" | "ask" | "condition" | "action" | "end";
  label: string;
  prompt?: string;
  expectedResponses?: string[];
  conditionVariable?: string;
  actionTool?: string;
  actionArgs?: Record<string, unknown>;
  position?: { x: number; y: number };
}

interface CallFlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  condition?: string;
}

interface CallFlow {
  id: string;
  name: string;
  description?: string;
  nodes: CallFlowNode[];
  edges: CallFlowEdge[];
  variables?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  notes?: string;
  language?: string;
  script?: string;
  callFlow?: CallFlow;
}

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "pt", label: "Português", flag: "🇵🇹" },
  { code: "nl", label: "Nederlands", flag: "🇳🇱" },
  { code: "pl", label: "Polski", flag: "🇵🇱" },
  { code: "cs", label: "Čeština", flag: "🇨🇿" },
  { code: "hu", label: "Magyar", flag: "🇭🇺" },
  { code: "ro", label: "Română", flag: "🇷🇴" },
  { code: "tr", label: "Türkçe", flag: "🇹🇷" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "ja", label: "日本語", flag: "🇯🇵" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "ko", label: "한국어", flag: "🇰🇷" },
  { code: "ar", label: "العربية", flag: "🇸🇦" },
];

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
    geminiBackend?: "aistudio" | "vertexai";
    gcpProjectId?: string;
    gcpLocation?: string;
    gcpServiceAccountKey?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
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
  const [newContact, setNewContact] = useState({ name: "", phone: "", notes: "", language: "en" });
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editContactData, setEditContactData] = useState({ name: "", phone: "", notes: "", language: "en" });
  const [scriptContactId, setScriptContactId] = useState<string | null>(null);
  const [scriptMode, setScriptMode] = useState<"simple" | "flow">("simple");
  const [scriptText, setScriptText] = useState("");
  const [callFlow, setCallFlow] = useState<CallFlow | null>(null);
  const [savingScript, setSavingScript] = useState(false);

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
      setNewContact({ name: "", phone: "", notes: "", language: "en" });
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

  function openScriptEditor(contact: Contact) {
    setScriptContactId(contact.id);
    if (contact.callFlow && contact.callFlow.nodes.length > 0) {
      setScriptMode("flow");
      setCallFlow(contact.callFlow);
      setScriptText(contact.script || "");
    } else {
      setScriptMode("simple");
      setScriptText(contact.script || "");
      setCallFlow(contact.callFlow || null);
    }
  }

  async function saveScript() {
    if (!scriptContactId) return;
    setSavingScript(true);
    try {
      const patch: Record<string, unknown> = {};
      if (scriptMode === "simple") {
        patch.script = scriptText.trim() || undefined;
        // Keep callFlow if it exists (user might switch modes)
        if (callFlow) patch.callFlow = callFlow;
      } else {
        patch.callFlow = callFlow;
        patch.script = scriptText.trim() || undefined;
      }
      const updated = await api.updateContact(scriptContactId, patch);
      setContacts(prev => prev.map(c => c.id === scriptContactId ? { ...c, ...updated } : c));
    } catch { /* silent */ }
    setSavingScript(false);
    setScriptContactId(null);
  }

  function addFlowNode(type: CallFlowNode["type"]) {
    if (!callFlow) return;
    const id = `node_${Date.now()}`;
    const nodeCount = callFlow.nodes.length;
    const newNode: CallFlowNode = {
      id,
      type,
      label: type === "start" ? "Start" : type === "end" ? "End" : `${type.charAt(0).toUpperCase() + type.slice(1)} ${nodeCount}`,
      prompt: "",
      position: { x: 100, y: 80 + nodeCount * 100 },
    };
    setCallFlow({ ...callFlow, nodes: [...callFlow.nodes, newNode] });
  }

  function updateFlowNode(nodeId: string, patch: Partial<CallFlowNode>) {
    if (!callFlow) return;
    setCallFlow({
      ...callFlow,
      nodes: callFlow.nodes.map(n => n.id === nodeId ? { ...n, ...patch } : n),
    });
  }

  function deleteFlowNode(nodeId: string) {
    if (!callFlow) return;
    setCallFlow({
      ...callFlow,
      nodes: callFlow.nodes.filter(n => n.id !== nodeId),
      edges: callFlow.edges.filter(e => e.from !== nodeId && e.to !== nodeId),
    });
  }

  function addFlowEdge(from: string, to: string, label?: string) {
    if (!callFlow) return;
    const id = `edge_${Date.now()}`;
    setCallFlow({
      ...callFlow,
      edges: [...callFlow.edges, { id, from, to, label: label || "" }],
    });
  }

  function deleteFlowEdge(edgeId: string) {
    if (!callFlow) return;
    setCallFlow({
      ...callFlow,
      edges: callFlow.edges.filter(e => e.id !== edgeId),
    });
  }

  function initializeCallFlow() {
    const contact = contacts.find(c => c.id === scriptContactId);
    setCallFlow({
      id: `flow_${Date.now()}`,
      name: contact?.name ? `${contact.name} Script` : "Call Script",
      nodes: [
        { id: "start_1", type: "start", label: "Start", position: { x: 100, y: 50 } },
        { id: "say_1", type: "say", label: "Greeting", prompt: "Greet the person naturally", position: { x: 100, y: 150 } },
        { id: "ask_1", type: "ask", label: "Main Question", prompt: "", expectedResponses: ["yes", "no"], position: { x: 100, y: 250 } },
        { id: "end_1", type: "end", label: "Goodbye", prompt: "Thank them and say goodbye", position: { x: 100, y: 350 } },
      ],
      edges: [
        { id: "e1", from: "start_1", to: "say_1", label: "begin" },
        { id: "e2", from: "say_1", to: "ask_1", label: "then" },
        { id: "e3", from: "ask_1", to: "end_1", label: "default" },
      ],
    });
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

  /** Update local settings state and mark as dirty (unsaved) */
  function editTelSettings(updates: Partial<NonNullable<typeof telSettings>>) {
    setTelSettings((prev) => prev ? { ...prev, ...updates } : prev);
    setSettingsDirty(true);
    setSettingsSaved(false);
  }

  /** Save all current settings at once */
  async function saveAllSettings() {
    if (!telSettings) return;
    setSaving(true);
    try {
      await api.updateTelephonySettings({
        freeswitch: telSettings.freeswitch,
        defaultVoice: telSettings.defaultVoice,
        maxCallDurationSeconds: telSettings.maxCallDurationSeconds,
        geminiBackend: telSettings.geminiBackend,
        gcpProjectId: telSettings.gcpProjectId,
        gcpLocation: telSettings.gcpLocation,
        gcpServiceAccountKey: telSettings.gcpServiceAccountKey,
      });
      const fresh = await api.getTelephonySettings();
      setTelSettings(fresh as typeof telSettings);
      setSettingsDirty(false);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
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
        setSelectedCall({ ...call, ...full });
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
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div>
                  <label className="text-[11px] text-cc-muted">Notes (optional)</label>
                  <input type="text" value={newContact.notes} onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                    placeholder="e.g. Mo-Sa 10-18 Uhr" className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                </div>
                <div>
                  <label className="text-[11px] text-cc-muted">Language</label>
                  <select value={newContact.language} onChange={(e) => setNewContact({ ...newContact, language: e.target.value })}
                    className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg w-28">
                    {LANGUAGE_OPTIONS.map(l => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
                  </select>
                </div>
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
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <input type="text" value={editContactData.notes} onChange={(e) => setEditContactData({ ...editContactData, notes: e.target.value })}
                          placeholder="Notes" className="px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                        <select value={editContactData.language} onChange={(e) => setEditContactData({ ...editContactData, language: e.target.value })}
                          className="px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg w-28">
                          {LANGUAGE_OPTIONS.map(l => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveContactEdit} className="px-2 py-1 text-[11px] rounded bg-green-600 text-white hover:bg-green-500 cursor-pointer">Save</button>
                        <button onClick={() => setEditingContactId(null)} className="px-2 py-1 text-[11px] rounded bg-cc-hover text-cc-muted hover:text-cc-fg cursor-pointer">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => {
                          setPhone(c.phone);
                          // Auto-populate prompt from script if available and prompt is empty
                          if (!prompt.trim() && c.script) {
                            setPrompt(c.script);
                          }
                        }}
                        className="min-w-0 flex-1 text-left cursor-pointer hover:opacity-80"
                        title="Click to use this number"
                      >
                        <p className="text-xs font-medium text-cc-fg">{c.name}</p>
                        <p className="text-[11px] text-cc-muted">
                          {c.phone}
                          {c.language && <span className="ml-1"> {LANGUAGE_OPTIONS.find(l => l.code === c.language)?.flag || ""}</span>}
                          {c.notes ? ` — ${c.notes}` : ""}
                          {(c.script || c.callFlow) && <span className="ml-1.5 text-green-500 text-[9px]">(script)</span>}
                        </p>
                      </button>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <button
                          onClick={() => openScriptEditor(c)}
                          className={`text-[11px] transition-colors cursor-pointer ${c.script || c.callFlow ? "text-green-500 hover:text-green-400" : "text-cc-muted hover:text-cc-fg"}`}
                          title={c.script || c.callFlow ? "Edit call script" : "Add call script"}
                        >
                          {c.script || c.callFlow ? "Script" : "+ Script"}
                        </button>
                        <button
                          onClick={() => { setEditingContactId(c.id); setEditContactData({ name: c.name, phone: c.phone, notes: c.notes || "", language: c.language || "en" }); }}
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

        {/* Script Editor Modal */}
        {scriptContactId && (
          <div className="bg-cc-card border border-cc-border rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">
                  Call Script — {contacts.find(c => c.id === scriptContactId)?.name}
                </h2>
                <p className="text-[10px] text-cc-muted mt-0.5">
                  Define what Gemini should say and how to handle responses during the call.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Mode toggle */}
                <div className="flex bg-cc-bg rounded-lg border border-cc-border overflow-hidden">
                  <button
                    onClick={() => setScriptMode("simple")}
                    className={`px-2.5 py-1 text-[11px] transition-colors cursor-pointer ${scriptMode === "simple" ? "bg-cc-primary text-white" : "text-cc-muted hover:text-cc-fg"}`}
                  >
                    Simple
                  </button>
                  <button
                    onClick={() => setScriptMode("flow")}
                    className={`px-2.5 py-1 text-[11px] transition-colors cursor-pointer ${scriptMode === "flow" ? "bg-cc-primary text-white" : "text-cc-muted hover:text-cc-fg"}`}
                  >
                    Flow Builder
                  </button>
                </div>
              </div>
            </div>

            {scriptMode === "simple" ? (
              /* Simple Script: Markdown textarea */
              <div className="space-y-2">
                <textarea
                  value={scriptText}
                  onChange={e => setScriptText(e.target.value)}
                  placeholder={`Example script:\n\n1. Greet and introduce yourself\n2. Ask if they have a table for 4 on Friday at 7pm\n3. If yes: confirm and ask for name\n4. If no: ask about Saturday\n5. Thank them and say goodbye\n\nIMPORTANT: Always be polite and speak German.`}
                  rows={10}
                  className="w-full px-3 py-2 text-xs bg-cc-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:border-cc-primary font-mono resize-y"
                />
                <p className="text-[10px] text-cc-muted">
                  Write a simple call script in plain text or markdown. Gemini will follow this as a guide during the call.
                </p>
              </div>
            ) : (
              /* Call Flow Builder */
              <div className="space-y-3">
                {!callFlow || callFlow.nodes.length === 0 ? (
                  <div className="text-center py-8 space-y-3">
                    <p className="text-xs text-cc-muted">No call flow defined yet.</p>
                    <button
                      onClick={initializeCallFlow}
                      className="px-3 py-1.5 text-xs rounded bg-cc-primary text-white hover:bg-cc-primary/90 transition-colors cursor-pointer"
                    >
                      Create Template Flow
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Flow metadata */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-cc-muted">Flow Name</label>
                        <input
                          type="text" value={callFlow.name}
                          onChange={e => setCallFlow({ ...callFlow, name: e.target.value })}
                          className="w-full px-2 py-1.5 text-xs bg-cc-bg border border-cc-border rounded text-cc-fg"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-cc-muted">Description</label>
                        <input
                          type="text" value={callFlow.description || ""}
                          onChange={e => setCallFlow({ ...callFlow, description: e.target.value })}
                          placeholder="e.g. Restaurant reservation flow"
                          className="w-full px-2 py-1.5 text-xs bg-cc-bg border border-cc-border rounded text-cc-fg"
                        />
                      </div>
                    </div>

                    {/* Nodes */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[11px] font-medium text-cc-muted uppercase tracking-wider">Nodes</h3>
                        <div className="flex gap-1">
                          {(["say", "ask", "condition", "action", "end"] as const).map(type => (
                            <button
                              key={type}
                              onClick={() => addFlowNode(type)}
                              className="px-1.5 py-0.5 text-[10px] rounded bg-cc-hover text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
                              title={`Add ${type} node`}
                            >
                              + {type}
                            </button>
                          ))}
                        </div>
                      </div>

                      {callFlow.nodes.map((node, idx) => (
                        <div key={node.id} className="bg-cc-bg rounded-lg px-3 py-2 border border-cc-border space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                node.type === "start" ? "bg-green-500/20 text-green-400" :
                                node.type === "end" ? "bg-red-500/20 text-red-400" :
                                node.type === "say" ? "bg-blue-500/20 text-blue-400" :
                                node.type === "ask" ? "bg-yellow-500/20 text-yellow-400" :
                                node.type === "condition" ? "bg-purple-500/20 text-purple-400" :
                                "bg-orange-500/20 text-orange-400"
                              }`}>{node.type}</span>
                              <input
                                type="text" value={node.label}
                                onChange={e => updateFlowNode(node.id, { label: e.target.value })}
                                className="px-1.5 py-0.5 text-xs bg-transparent border-b border-cc-border/50 text-cc-fg focus:outline-none focus:border-cc-primary w-40"
                              />
                            </div>
                            {node.type !== "start" && (
                              <button
                                onClick={() => deleteFlowNode(node.id)}
                                className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer"
                              >
                                remove
                              </button>
                            )}
                          </div>

                          {(node.type === "say" || node.type === "ask" || node.type === "end") && (
                            <textarea
                              value={node.prompt || ""}
                              onChange={e => updateFlowNode(node.id, { prompt: e.target.value })}
                              placeholder={node.type === "say" ? "What should the AI say?" : node.type === "ask" ? "What question to ask?" : "Goodbye message"}
                              rows={2}
                              className="w-full px-2 py-1 text-[11px] bg-cc-hover border border-cc-border rounded text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:border-cc-primary resize-none"
                            />
                          )}

                          {node.type === "ask" && (
                            <div>
                              <label className="text-[10px] text-cc-muted">Expected responses (comma-separated)</label>
                              <input
                                type="text"
                                value={(node.expectedResponses || []).join(", ")}
                                onChange={e => updateFlowNode(node.id, { expectedResponses: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                                placeholder="yes, no, maybe"
                                className="w-full px-2 py-1 text-[11px] bg-cc-hover border border-cc-border rounded text-cc-fg"
                              />
                            </div>
                          )}

                          {node.type === "condition" && (
                            <div>
                              <label className="text-[10px] text-cc-muted">Condition / Variable</label>
                              <input
                                type="text"
                                value={node.conditionVariable || ""}
                                onChange={e => updateFlowNode(node.id, { conditionVariable: e.target.value })}
                                placeholder="e.g. callee said yes"
                                className="w-full px-2 py-1 text-[11px] bg-cc-hover border border-cc-border rounded text-cc-fg"
                              />
                            </div>
                          )}

                          {node.type === "action" && (
                            <div>
                              <label className="text-[10px] text-cc-muted">Tool to call</label>
                              <input
                                type="text"
                                value={node.actionTool || ""}
                                onChange={e => updateFlowNode(node.id, { actionTool: e.target.value })}
                                placeholder="e.g. save_note, end_call"
                                className="w-full px-2 py-1 text-[11px] bg-cc-hover border border-cc-border rounded text-cc-fg"
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Edges */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[11px] font-medium text-cc-muted uppercase tracking-wider">Connections</h3>
                      </div>

                      {callFlow.edges.map(edge => {
                        const fromNode = callFlow.nodes.find(n => n.id === edge.from);
                        const toNode = callFlow.nodes.find(n => n.id === edge.to);
                        return (
                          <div key={edge.id} className="flex items-center gap-2 text-[11px]">
                            <span className="text-cc-fg">{fromNode?.label || edge.from}</span>
                            <span className="text-cc-muted">→</span>
                            <input
                              type="text" value={edge.label || ""}
                              onChange={e => {
                                setCallFlow({
                                  ...callFlow,
                                  edges: callFlow.edges.map(ed => ed.id === edge.id ? { ...ed, label: e.target.value } : ed),
                                });
                              }}
                              placeholder="condition"
                              className="w-20 px-1.5 py-0.5 text-[10px] bg-cc-hover border border-cc-border rounded text-cc-fg text-center"
                            />
                            <span className="text-cc-muted">→</span>
                            <select
                              value={edge.to}
                              onChange={e => {
                                setCallFlow({
                                  ...callFlow,
                                  edges: callFlow.edges.map(ed => ed.id === edge.id ? { ...ed, to: e.target.value } : ed),
                                });
                              }}
                              className="px-1.5 py-0.5 text-[11px] bg-cc-hover border border-cc-border rounded text-cc-fg"
                            >
                              {callFlow.nodes.map(n => (
                                <option key={n.id} value={n.id}>{n.label}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => deleteFlowEdge(edge.id)}
                              className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer"
                            >
                              x
                            </button>
                          </div>
                        );
                      })}

                      {/* Add edge */}
                      {callFlow.nodes.length >= 2 && (
                        <div className="flex items-center gap-2">
                          <select id="edge-from" className="px-1.5 py-0.5 text-[11px] bg-cc-hover border border-cc-border rounded text-cc-fg">
                            {callFlow.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                          </select>
                          <span className="text-[11px] text-cc-muted">→</span>
                          <select id="edge-to" className="px-1.5 py-0.5 text-[11px] bg-cc-hover border border-cc-border rounded text-cc-fg">
                            {callFlow.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                          </select>
                          <button
                            onClick={() => {
                              const from = (document.getElementById("edge-from") as HTMLSelectElement)?.value;
                              const to = (document.getElementById("edge-to") as HTMLSelectElement)?.value;
                              if (from && to && from !== to) addFlowEdge(from, to);
                            }}
                            className="px-1.5 py-0.5 text-[10px] rounded bg-cc-hover text-cc-muted hover:text-cc-fg cursor-pointer"
                          >
                            + Connect
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Template Variables */}
                    <details className="group">
                      <summary className="text-[11px] text-cc-muted cursor-pointer hover:text-cc-fg">
                        Template Variables ({Object.keys(callFlow.variables || {}).length})
                      </summary>
                      <div className="mt-2 space-y-1">
                        {Object.entries(callFlow.variables || {}).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2">
                            <span className="text-[11px] text-cc-muted font-mono">{`{{${key}}}`}</span>
                            <input
                              type="text" value={value}
                              onChange={e => setCallFlow({ ...callFlow, variables: { ...callFlow.variables, [key]: e.target.value } })}
                              className="flex-1 px-2 py-0.5 text-[11px] bg-cc-hover border border-cc-border rounded text-cc-fg"
                            />
                            <button
                              onClick={() => {
                                const vars = { ...callFlow.variables };
                                delete vars[key];
                                setCallFlow({ ...callFlow, variables: vars });
                              }}
                              className="text-[10px] text-red-400 cursor-pointer"
                            >x</button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const key = window.prompt("Variable name:");
                            if (key) setCallFlow({ ...callFlow, variables: { ...callFlow.variables, [key]: "" } });
                          }}
                          className="text-[10px] text-cc-primary hover:text-cc-primary/80 cursor-pointer"
                        >
                          + Add Variable
                        </button>
                      </div>
                    </details>
                  </>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-cc-border">
              <button
                onClick={() => setScriptContactId(null)}
                className="px-3 py-1.5 text-xs rounded bg-cc-hover text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                {(scriptText || (callFlow && callFlow.nodes.length > 0)) && (
                  <button
                    onClick={() => { setScriptText(""); setCallFlow(null); }}
                    className="px-3 py-1.5 text-xs rounded text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                  >
                    Clear Script
                  </button>
                )}
                <button
                  onClick={saveScript}
                  disabled={savingScript}
                  className="px-4 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-500 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {savingScript ? "Saving..." : "Save Script"}
                </button>
              </div>
            </div>
          </div>
        )}

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
                          onChange={(e) => editTelSettings({ freeswitch: { ...telSettings.freeswitch, eslHost: e.target.value } })}
                          className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                      </div>
                      <div>
                        <label className="text-[11px] text-cc-muted">Port</label>
                        <input type="number" value={telSettings.freeswitch.eslPort}
                          onChange={(e) => editTelSettings({ freeswitch: { ...telSettings.freeswitch, eslPort: parseInt(e.target.value) || 8021 } })}
                          className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-cc-muted">ESL Password</label>
                      <input type="password" value={telSettings.freeswitch.eslPassword || ""}
                        onChange={(e) => editTelSettings({ freeswitch: { ...telSettings.freeswitch, eslPassword: e.target.value } })}
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

                  {/* Defaults */}
                  <div className="bg-cc-bg rounded-lg p-3 space-y-2 border border-cc-border">
                    <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Defaults</h3>
                    <div>
                      <label className="text-[11px] text-cc-muted">Max Call Duration (seconds)</label>
                      <input type="number" value={telSettings.maxCallDurationSeconds || 600}
                        onChange={(e) => editTelSettings({ maxCallDurationSeconds: parseInt(e.target.value) || 600 })}
                        className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg" />
                      <p className="text-[10px] text-cc-muted mt-0.5">Safety limit — calls are automatically ended after this duration</p>
                    </div>
                  </div>

                  {/* Gemini Live Backend */}
                  <div className="bg-cc-bg rounded-lg p-3 space-y-3 border border-cc-border">
                    <h3 className="text-xs font-semibold text-cc-muted uppercase tracking-wider">Gemini Live Backend</h3>
                    <div>
                      <label className="text-[11px] text-cc-muted">Backend</label>
                      <select
                        value={telSettings.geminiBackend || "aistudio"}
                        onChange={(e) => editTelSettings({ geminiBackend: e.target.value as "aistudio" | "vertexai" })}
                        className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg"
                      >
                        <option value="aistudio">Google AI Studio (default — US routing)</option>
                        <option value="vertexai">Vertex AI (EU routing — lower latency)</option>
                      </select>
                      <p className="text-[10px] text-cc-muted mt-0.5">
                        {telSettings.geminiBackend === "vertexai"
                          ? "Model: gemini-live-2.5-flash-native-audio (Chirp3-HD voices, 30 voices, 24 languages)"
                          : "Model: gemini-3.1-flash-live-preview"}
                      </p>
                    </div>

                    {/* Voice — changes based on backend */}
                    <div>
                      <label className="text-[11px] text-cc-muted">Default Voice</label>
                      <select value={telSettings.defaultVoice || "Puck"} onChange={(e) => editTelSettings({ defaultVoice: e.target.value })}
                        className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg">
                        {telSettings.geminiBackend === "vertexai" ? (
                          <>
                            <optgroup label="Male">
                              <option value="Puck">Puck</option>
                              <option value="Charon">Charon</option>
                              <option value="Fenrir">Fenrir</option>
                              <option value="Orus">Orus</option>
                              <option value="Achird">Achird</option>
                              <option value="Algenib">Algenib</option>
                              <option value="Algieba">Algieba</option>
                              <option value="Alnilam">Alnilam</option>
                              <option value="Enceladus">Enceladus</option>
                              <option value="Iapetus">Iapetus</option>
                              <option value="Rasalgethi">Rasalgethi</option>
                              <option value="Sadachbia">Sadachbia</option>
                              <option value="Sadaltager">Sadaltager</option>
                              <option value="Schedar">Schedar</option>
                              <option value="Umbriel">Umbriel</option>
                              <option value="Zubenelgenubi">Zubenelgenubi</option>
                            </optgroup>
                            <optgroup label="Female">
                              <option value="Kore">Kore</option>
                              <option value="Aoede">Aoede</option>
                              <option value="Leda">Leda</option>
                              <option value="Zephyr">Zephyr</option>
                              <option value="Achernar">Achernar</option>
                              <option value="Autonoe">Autonoe</option>
                              <option value="Callirrhoe">Callirrhoe</option>
                              <option value="Despina">Despina</option>
                              <option value="Erinome">Erinome</option>
                              <option value="Gacrux">Gacrux</option>
                              <option value="Laomedeia">Laomedeia</option>
                              <option value="Pulcherrima">Pulcherrima</option>
                              <option value="Sulafat">Sulafat</option>
                              <option value="Vindemiatrix">Vindemiatrix</option>
                            </optgroup>
                          </>
                        ) : (
                          <>
                            <optgroup label="Male">
                              <option value="Kore">Kore</option>
                              <option value="Puck">Puck</option>
                              <option value="Charon">Charon</option>
                              <option value="Fenrir">Fenrir</option>
                            </optgroup>
                            <optgroup label="Female">
                              <option value="Aoede">Aoede</option>
                              <option value="Leda">Leda</option>
                            </optgroup>
                          </>
                        )}
                      </select>
                      <p className="text-[10px] text-cc-muted mt-0.5">
                        {telSettings.geminiBackend === "vertexai"
                          ? "Chirp3-HD voices — note: Kore is female on Vertex AI (unlike AI Studio)"
                          : "Standard Gemini Live voices"}
                      </p>
                    </div>

                    {telSettings.geminiBackend === "vertexai" && (
                      <div className="space-y-3 mt-1 pl-2 border-l-2 border-cc-primary/30">
                        <div className="text-[10px] text-cc-muted space-y-1">
                          <p>
                            Vertex AI routes Gemini Live audio through a Google Cloud region you control (e.g. Netherlands) instead of the default US routing. This can significantly reduce latency for European callers.
                          </p>
                          <p>
                            <strong>Setup required:</strong> Create a GCP project, enable the <em>Vertex AI API</em>, set up billing, and create a service account with the <em>Vertex AI Administrator</em> role. Download the service account key as JSON and place it on this server.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-cc-muted">GCP Project ID</label>
                            <input
                              type="text"
                              value={telSettings.gcpProjectId || ""}
                              onChange={(e) => editTelSettings({ gcpProjectId: e.target.value })}
                              placeholder="my-project-id"
                              className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg"
                            />
                            <p className="text-[10px] text-cc-muted mt-0.5">Find this in the GCP Console dashboard</p>
                          </div>
                          <div>
                            <label className="text-[11px] text-cc-muted">Region</label>
                            <select
                              value={telSettings.gcpLocation || "europe-west4"}
                              onChange={(e) => editTelSettings({ gcpLocation: e.target.value })}
                              className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg"
                            >
                              <option value="europe-west4">europe-west4 (Netherlands)</option>
                              <option value="europe-west3">europe-west3 (Frankfurt)</option>
                              <option value="europe-west1">europe-west1 (Belgium)</option>
                              <option value="us-central1">us-central1 (Iowa)</option>
                            </select>
                            <p className="text-[10px] text-cc-muted mt-0.5">Choose the region closest to your server</p>
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-cc-muted">Service Account Key</label>
                          <input
                            type="text"
                            value={telSettings.gcpServiceAccountKey || ""}
                            onChange={(e) => editTelSettings({ gcpServiceAccountKey: e.target.value })}
                            placeholder="/path/to/service-account-key.json"
                            className="w-full px-2 py-1.5 text-xs bg-cc-hover border border-cc-border rounded text-cc-fg font-mono"
                          />
                          <p className="text-[10px] text-cc-muted mt-0.5">Absolute path to the JSON key file on this server. Create one in GCP Console → IAM → Service Accounts → Keys.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Save Button */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={saveAllSettings}
                      disabled={saving || !settingsDirty}
                      className={`px-4 py-2 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                        settingsDirty
                          ? "bg-cc-primary text-white hover:opacity-90 shadow-sm"
                          : "bg-cc-hover text-cc-muted"
                      } disabled:opacity-50 disabled:cursor-default`}
                    >
                      {saving ? "Saving..." : "Save Settings"}
                    </button>
                    {settingsSaved && (
                      <span className="text-xs text-green-500 animate-fade-in">Settings saved</span>
                    )}
                    {settingsDirty && !saving && (
                      <span className="text-[11px] text-amber-400">Unsaved changes</span>
                    )}
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
