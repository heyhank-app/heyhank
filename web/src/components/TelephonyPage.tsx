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

export function TelephonyPage({ embedded }: { embedded?: boolean }) {
  const [phone, setPhone] = useState("");
  const [prompt, setPrompt] = useState("");
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState("");
  const [activeCalls, setActiveCalls] = useState<CallInfo[]>([]);
  const [history, setHistory] = useState<CallInfo[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallInfo | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<Array<{ speaker: string; text: string; ts: number }>>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Load active calls and history
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
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
