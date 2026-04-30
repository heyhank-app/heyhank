// ─── SocialViewTab ───────────────────────────────────────────────────────────
// UI for the browser-based social media viewer. Starts/stops a headed Chromium
// per platform on the server, embeds the noVNC viewer via iframe so Markus can
// log in once per platform. Session persists across restarts.

import { useEffect, useState, useCallback } from "react";

type Platform = "instagram" | "twitter" | "linkedin" | "facebook" | "tiktok";

interface PlatformStatus {
  platform: Platform;
  running: boolean;
  loggedIn: boolean | null;
  currentUrl: string | null;
  startedAt: number | null;
}

interface SocialViewStatusResponse {
  vnc: { x11vnc: boolean; websockify: boolean; port: number };
  platforms: PlatformStatus[];
}

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  twitter: "X (Twitter)",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  tiktok: "TikTok",
};

const PLATFORM_ORDER: Platform[] = ["instagram", "twitter", "linkedin", "facebook", "tiktok"];

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("heyhank_auth_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

interface Props {
  showMessage: (text: string, isError?: boolean) => void;
}

export function SocialViewTab({ showMessage }: Props): React.ReactElement {
  const [status, setStatus] = useState<SocialViewStatusResponse | null>(null);
  const [selected, setSelected] = useState<Platform | null>(null);
  const [loading, setLoading] = useState<Platform | "refresh" | "extract" | null>(null);
  const [gotoUrl, setGotoUrl] = useState("");
  const [extractSource, setExtractSource] = useState<"own" | "role-model">("role-model");
  const [extractLogs, setExtractLogs] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<SocialViewStatusResponse>("/api/socialview/status");
      setStatus(data);
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Failed to load status", true);
    }
  }, [showMessage]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleStart(platform: Platform) {
    setLoading(platform);
    try {
      await apiPost(`/api/socialview/${platform}/start`);
      showMessage(`${PLATFORM_LABELS[platform]} browser started.`);
      setSelected(platform);
      await refresh();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Start failed", true);
    } finally {
      setLoading(null);
    }
  }

  async function handleStop(platform: Platform) {
    setLoading(platform);
    try {
      await apiPost(`/api/socialview/${platform}/stop`);
      showMessage(`${PLATFORM_LABELS[platform]} browser stopped.`);
      if (selected === platform) setSelected(null);
      await refresh();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Stop failed", true);
    } finally {
      setLoading(null);
    }
  }

  async function handleGoto() {
    if (!selected || !gotoUrl.trim()) return;
    setLoading(selected);
    try {
      await apiPost(`/api/socialview/${selected}/goto`, { url: gotoUrl.trim() });
      showMessage(`Navigated to ${gotoUrl}`);
      setGotoUrl("");
      await refresh();
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Navigation failed", true);
    } finally {
      setLoading(null);
    }
  }

  async function handleExtract() {
    if (!selected) return;
    const selectedStatus = platforms.find((p) => p.platform === selected);
    const currentUrl = selectedStatus?.currentUrl || "(unknown)";
    const confirmMsg =
      `Extract from this URL?\n\n${currentUrl}\n\nSource: ${extractSource}\n\n` +
      `Make sure the browser is on the correct page (the intended profile/post) before confirming.`;
    if (typeof window !== "undefined" && !window.confirm(confirmMsg)) return;

    setLoading("extract");
    setExtractLogs([`→ Starting extract from ${currentUrl}`]);
    const append = (line: string) => setExtractLogs((prev) => [...prev, line]);

    try {
      const res = await fetch(`/api/socialview/${selected}/extract-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ source: extractSource }),
      });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalMsg: string | null = null;
      let finalError = false;

      // SSE frames are separated by \n\n, each event has lines "event: X" and "data: Y"
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let evName = "message";
          let dataStr = "";
          for (const l of frame.split("\n")) {
            if (l.startsWith("event:")) evName = l.slice(6).trim();
            else if (l.startsWith("data:")) dataStr += l.slice(5).trim();
          }
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(dataStr); } catch { /* keep empty */ }

          if (evName === "log") {
            append(String(payload.message ?? ""));
          } else if (evName === "url") {
            append(`URL at start: ${payload.url ?? ""}`);
          } else if (evName === "done") {
            const n = Number(payload.extracted) || 0;
            const errs = Array.isArray(payload.errors) ? (payload.errors as string[]) : [];
            append(`✓ Done — extracted ${n} post${n === 1 ? "" : "s"}`);
            for (const e of errs) append(`  ! ${e}`);
            finalMsg = n > 0
              ? `Extracted ${n} post${n === 1 ? "" : "s"}. Review in Library tab.`
              : (errs.length > 0 ? errs.join("; ") : "Nothing extracted on this page");
            finalError = n === 0;
          } else if (evName === "fatal") {
            append(`✗ Fatal: ${payload.error ?? "extract failed"}`);
            finalMsg = String(payload.error ?? "Extract failed");
            finalError = true;
          }
        }
      }
      if (finalMsg) showMessage(finalMsg, finalError);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Extract failed";
      append(`✗ ${msg}`);
      showMessage(msg, true);
    } finally {
      setLoading(null);
    }
  }

  const platforms = status?.platforms ?? PLATFORM_ORDER.map((p): PlatformStatus => ({
    platform: p, running: false, loggedIn: null, currentUrl: null, startedAt: null,
  }));

  const anyRunning = platforms.some((p) => p.running);
  const vncReady = !!status?.vnc.websockify && !!status?.vnc.x11vnc;

  // noVNC URL: autoconnect, no scaling, no password.
  // IMPORTANT: path= must include the /socialview/vnc/ prefix because noVNC
  // builds the WebSocket URL as wss://HOST/<path>, not relative to the page.
  const vncUrl = "/socialview/vnc/vnc.html?autoconnect=1&resize=remote&reconnect=1&show_dot=1&path=socialview/vnc/websockify";

  return (
    <div className="space-y-4">
      <div className="text-xs text-cc-muted bg-cc-surface border border-cc-border rounded-md p-3">
        <strong className="text-cc-fg">Wie das funktioniert:</strong> Klick "Start" bei einer
        Plattform. Der Server öffnet einen echten Browser. Unten siehst du den Browser — logg dich
        einmal ein. Die Session bleibt erhalten (Cookies persistieren auf dem Server). Später
        kann der Content Agent hier Posts ansehen zum Lernen.
      </div>

      {/* Platform buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {platforms.map((p) => {
          const isLoading = loading === p.platform;
          const isSelected = selected === p.platform;
          return (
            <div
              key={p.platform}
              className={`border rounded-md p-3 transition-colors ${
                isSelected
                  ? "border-cc-accent bg-cc-accent/5"
                  : "border-cc-border bg-cc-surface"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-cc-fg">
                    {PLATFORM_LABELS[p.platform]}
                  </span>
                  {p.running && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        p.loggedIn
                          ? "bg-green-500/15 text-green-400"
                          : "bg-yellow-500/15 text-yellow-400"
                      }`}
                    >
                      {p.loggedIn ? "logged in" : "login required"}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  {!p.running ? (
                    <button
                      onClick={() => handleStart(p.platform)}
                      disabled={isLoading}
                      className="text-xs px-2 py-1 rounded bg-cc-accent text-white hover:bg-cc-accent/90 disabled:opacity-50"
                    >
                      {isLoading ? "Starting…" : "Start"}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setSelected(p.platform)}
                        disabled={isSelected}
                        className="text-xs px-2 py-1 rounded bg-cc-accent/10 text-cc-accent border border-cc-accent/30 disabled:opacity-50"
                      >
                        {isSelected ? "Viewing" : "View"}
                      </button>
                      <button
                        onClick={() => handleStop(p.platform)}
                        disabled={isLoading}
                        className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {isLoading ? "…" : "Stop"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {p.currentUrl && (
                <div className="text-[11px] text-cc-muted truncate" title={p.currentUrl}>
                  {p.currentUrl}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Go-to URL + Extract controls */}
      {selected && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="url"
              value={gotoUrl}
              onChange={(e) => setGotoUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleGoto(); }}
              placeholder={`z.B. https://www.instagram.com/username/`}
              className="flex-1 text-xs px-2 py-1.5 rounded-md bg-cc-bg border border-cc-border text-cc-fg"
            />
            <button
              onClick={handleGoto}
              disabled={!gotoUrl.trim() || loading === selected}
              className="text-xs px-3 py-1.5 rounded-md bg-cc-accent text-white hover:bg-cc-accent/90 disabled:opacity-50"
            >
              Go
            </button>
          </div>

          {/* Current URL prominently shown so user confirms the right page is open */}
          <div className="border border-cc-border rounded-md bg-cc-bg p-2 text-[11px]">
            <div className="text-cc-muted mb-0.5">Browser ist aktuell auf:</div>
            <div className="font-mono text-cc-fg break-all">
              {platforms.find((p) => p.platform === selected)?.currentUrl || "(unbekannt — Browser starten)"}
            </div>
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-[11px] text-cc-muted">Source:</label>
            <select
              value={extractSource}
              onChange={(e) => setExtractSource(e.target.value as "own" | "role-model")}
              className="text-xs px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-fg"
            >
              <option value="role-model">Role Model (fremd, Best-Practice lernen)</option>
              <option value="own">Own (eigener Account, Stil-Konsistenz)</option>
            </select>
            <button
              onClick={handleExtract}
              disabled={loading === "extract"}
              className="text-xs px-3 py-1.5 rounded-md bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50"
              title="Extract the post or profile currently shown below"
            >
              {loading === "extract" ? "Extracting…" : "Extract this page → Library"}
            </button>
            {extractLogs.length > 0 && (
              <button
                onClick={() => setExtractLogs([])}
                className="text-[11px] px-2 py-1 rounded-md bg-cc-bg border border-cc-border text-cc-muted hover:text-cc-fg"
              >
                Clear log
              </button>
            )}
          </div>

          {/* Live extract log */}
          {extractLogs.length > 0 && (
            <div className="border border-cc-border rounded-md bg-black/40 p-2 max-h-48 overflow-auto font-mono text-[11px] leading-relaxed text-cc-fg">
              {extractLogs.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">{l}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VNC viewer */}
      <div className="border border-cc-border rounded-md overflow-hidden bg-black">
        {anyRunning && vncReady ? (
          <iframe
            src={vncUrl}
            title="Social View Browser"
            className="w-full"
            style={{ height: "720px" }}
          />
        ) : (
          <div className="p-12 text-center text-sm text-cc-muted">
            {anyRunning
              ? "VNC wird gestartet…"
              : "Starte eine Plattform oben, um den Browser hier zu sehen."}
          </div>
        )}
      </div>
    </div>
  );
}
