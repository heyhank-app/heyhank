// ─── HankChat ────────────────────────────────────────────────────────────────
// Provider-agnostic chat overlay — replaces VoiceChat.
// Supports: Gemini Live (voice+text), Ollama, Claude, OpenAI, OpenRouter (text SSE).
// Gemini Live uses the existing client-side WebSocket; all others use POST /api/hank/chat SSE.

import { useState, useRef, useCallback, useEffect, lazy, Suspense } from "react";
import { api } from "../api.js";
import type { TalkingHeadAvatarHandle } from "./TalkingHeadAvatar";

// Lazy-load the 3D avatar so three.js (~600kB) only ships when a user opens
// the chat overlay. Also lets devices without WebGL fail gracefully.
const TalkingHeadAvatar = lazy(() =>
  import("./TalkingHeadAvatar").then(m => ({ default: m.TalkingHeadAvatar })),
);

type ChatProvider = "gemini-live" | "ollama" | "claude" | "openai" | "openrouter" | "gemini-text";
type ChatState = "idle" | "connecting" | "listening" | "speaking" | "toolCall" | "streaming";

const PROVIDER_LABELS: Record<ChatProvider, string> = {
  "gemini-live": "Gemini Live",
  "ollama": "Ollama",
  "claude": "Claude",
  "openai": "OpenAI",
  "openrouter": "OpenRouter",
  "gemini-text": "Gemini",
};

/** Human-readable labels for tool calls */
const TOOL_LABELS: Record<string, string> = {
  run_agent: "Starting agent",
  create_agent: "Creating agent",
  monitor_agent_session: "Checking agent",
  list_sessions: "Loading sessions",
  create_session: "Creating session",
  send_message: "Sending message",
  get_session_status: "Checking status",
  list_todos: "Loading tasks",
  add_todo: "Adding task",
  complete_todo: "Completing task",
  update_todo: "Updating task",
  delete_todo: "Deleting task",
  search_notes: "Searching notes",
  add_note: "Saving note",
  update_note: "Updating note",
  delete_note: "Deleting note",
  list_reminders: "Loading reminders",
  add_reminder: "Setting reminder",
  delete_reminder: "Deleting reminder",
  list_email_accounts: "Loading email accounts",
  list_emails: "Fetching emails",
  read_email: "Reading email",
  search_emails: "Searching emails",
  send_email: "Sending email",
  reply_email: "Replying to email",
  email_summary: "Email summary",
  list_calendar_accounts: "Loading calendars",
  list_events: "Fetching events",
  create_event: "Creating event",
  search_events: "Searching events",
  delete_event: "Deleting event",
  calendar_summary: "Calendar overview",
  make_call: "Placing call",
  list_active_calls: "Checking calls",
  end_active_call: "Ending call",
  prepare_social_post: "Preparing draft",
  create_social_post: "Publishing post",
  list_social_posts: "Loading posts",
  publish_draft: "Publishing draft",
  save_memory: "Saving memory",
  search_memory: "Searching memory",
};

function friendlyToolName(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, " ");
}

// Map Gemini / agent tool names to a TalkingHead gesture so the avatar
// visibly reacts while an action is being performed. Keep the mapping
// conservative — unknown tools fall back to a generic "handup".
// Supported gestures (TalkingHead 1.7): handup, index, ok, thumbup,
// thumbdown, side, shrug, namaste.
function gestureForTool(name: string): string {
  if (!name) return "handup";
  if (/search|find|list|get|query|fetch|read|load/i.test(name)) return "index";
  if (/create|add|save|write|publish|prepare|make|send|post|update/i.test(name)) return "thumbup";
  if (/delete|remove|cancel|end/i.test(name)) return "thumbdown";
  if (/call|dial|ring/i.test(name)) return "ok";
  if (/agent|run|execute/i.test(name)) return "namaste";
  return "handup";
}

interface TranscriptEntry {
  role: "user" | "assistant" | "system" | "session_event";
  text: string;
  ts: number;
  imageUrl?: string;
  link?: { label: string; href: string };
}

interface Attachment {
  url: string;
  absolutePath: string;
  mimeType: string;
  name: string;
  dataUrl?: string; // for preview
}

// Lazy-load audio/client modules for Gemini Live
const loadAudioModules = () => Promise.all([
  import("../lib/gemini-audio.js"),
  import("../lib/gemini-live-client.js"),
] as const);

type AudioRecorderType = import("../lib/gemini-audio.js").AudioRecorder;
type AudioStreamerType = import("../lib/gemini-audio.js").AudioStreamer;
type GeminiLiveClientType = import("../lib/gemini-live-client.js").GeminiLiveClient;
type GeminiLiveEvent = import("../lib/gemini-live-client.js").GeminiLiveEvent;
type GeminiToolCall = import("../lib/gemini-live-client.js").GeminiToolCall;
type TextChatEvent = import("../lib/text-chat-client.js").TextChatEvent;

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("heyhank_auth_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

/** Execute a Gemini tool call via the backend */
async function executeToolCall(call: GeminiToolCall): Promise<unknown> {
  try {
    const res = await fetch("/api/gemini/tool-call", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ name: call.name, args: call.args }),
    });
    const data = await res.json();
    return data.result || { error: "No result" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Convert a File to base64 */
function fileToBase64(file: File): Promise<{ base64: string; mimeType: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      resolve({ base64, mimeType: file.type, dataUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Capture a frame from a video element */
function captureVideoFrame(video: HTMLVideoElement, quality = 0.7): { base64: string; dataUrl: string } {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.split(",")[1];
  return { base64, dataUrl };
}

/** Draggable position hook */
function useDraggable(initialX: number, initialY: number) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    hasMoved.current = false;
    dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      hasMoved.current = true;
      const newX = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragStart.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragStart.current.y));
      setPos({ x: newX, y: newY });
    };
    const onPointerUp = () => { dragging.current = false; };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  return { pos, setPos, onPointerDown, didDrag: () => hasMoved.current };
}

export function HankChat() {
  const [authenticated, setAuthenticated] = useState(() => !!localStorage.getItem("heyhank_auth_token"));

  // Listen for auth changes (login/logout from other components)
  useEffect(() => {
    const check = () => setAuthenticated(!!localStorage.getItem("heyhank_auth_token"));
    window.addEventListener("storage", check);
    window.addEventListener("heyhank-auth-changed", check);
    // Poll briefly in case token is set after mount (e.g. auto-auth on localhost)
    const id = setInterval(check, 2000);
    return () => { window.removeEventListener("storage", check); window.removeEventListener("heyhank-auth-changed", check); clearInterval(id); };
  }, []);

  const [provider, setProvider] = useState<ChatProvider | null>(null);
  const [state, setState] = useState<ChatState>("idle");
  const [expanded, setExpanded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [geminiTextBuffer, setGeminiTextBuffer] = useState("");
  const [displayName, setDisplayName] = useState("Hank");
  const [cameraActive, setCameraActive] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [providerKeyStatus, setProviderKeyStatus] = useState<Record<string, boolean>>({});
  const [modelOverride, setModelOverride] = useState("");
  // 3D TalkingHead avatar (opt-in via settings; only used with gemini-live).
  const [avatarEnabled, setAvatarEnabled] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState("https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb");
  const [avatarReady, setAvatarReady] = useState(false);
  const avatarRef = useRef<TalkingHeadAvatarHandle | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Gemini Live refs
  const recorderRef = useRef<AudioRecorderType | null>(null);
  const streamerRef = useRef<AudioStreamerType | null>(null);
  const clientRef = useRef<GeminiLiveClientType | null>(null);
  const sessionStartRef = useRef<number>(0);
  const modelSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Text SSE refs
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<Array<{ role: "user" | "assistant" | "system"; content: string | Array<{ type: "text" | "image_url" | "document"; text?: string; image_url?: { url: string } }> }>>([]);

  const isGeminiLive = provider === "gemini-live";
  const providerLoading = provider === null;

  // Draggable positions
  const { pos, setPos: setMicPos, onPointerDown, didDrag } = useDraggable(
    typeof window !== "undefined" ? window.innerWidth - 80 : 0,
    typeof window !== "undefined" ? window.innerHeight - 80 : 0,
  );
  const { pos: overlayPos, onPointerDown: onOverlayPointerDown, setPos: setOverlayPos } = useDraggable(
    typeof window !== "undefined" ? window.innerWidth - 380 : 0,
    typeof window !== "undefined" ? Math.max(20, window.innerHeight - 560) : 0,
  );

  // Load saved provider from settings
  const loadSettings = useCallback(() => {
    fetch("/api/settings", { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(s => {
        setProvider(prev => {
          const saved = (s.hankChatProvider || "gemini-live") as ChatProvider;
          // Only update if idle (don't disrupt an active session)
          if (prev === null || state === "idle") return saved;
          return prev;
        });
        if (s.assistantName) setDisplayName(s.assistantName || "Hank");
        if (s.hankChatModel) setModelOverride(s.hankChatModel);
        if (typeof s.hankChatAvatarEnabled === "boolean") setAvatarEnabled(s.hankChatAvatarEnabled);
        if (typeof s.hankChatAvatarUrl === "string" && s.hankChatAvatarUrl) setAvatarUrl(s.hankChatAvatarUrl);
        const keyMap: Record<string, boolean> = {
          "gemini-live": !!s.geminiApiKeyConfigured || !!s.geminiApiKey,
          "claude": !!s.anthropicApiKeyConfigured || !!s.anthropicApiKey,
          "openai": !!s.openaiApiKeyConfigured || !!s.openaiApiKey,
          "ollama": true,
          "openrouter": true,
          "gemini-text": !!s.geminiApiKeyConfigured || !!s.geminiApiKey,
        };
        setProviderKeyStatus(keyMap);
      })
      .catch(() => { setProvider(p => p ?? "gemini-live"); });
  }, [state]);

  // Load on mount
  useEffect(() => { loadSettings(); }, []);

  // Re-load when settings change (dispatched by SettingsPage) or tab becomes visible
  useEffect(() => {
    const onSettingsChanged = () => { if (state === "idle") loadSettings(); };
    const onVisibilityChange = () => { if (document.visibilityState === "visible" && state === "idle") loadSettings(); };
    window.addEventListener("heyhank-settings-changed", onSettingsChanged);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("heyhank-settings-changed", onSettingsChanged);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [state, loadSettings]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript, geminiTextBuffer]);

  const addTranscript = useCallback((role: TranscriptEntry["role"], text: string, imageUrl?: string, link?: TranscriptEntry["link"]) => {
    setTranscript(prev => [...prev.slice(-200), { role, text, ts: Date.now(), imageUrl, link }]);
  }, []);

  const flushGeminiBuffer = useCallback(() => {
    setGeminiTextBuffer(buf => {
      if (buf.trim()) addTranscript("assistant", buf.trim());
      return "";
    });
  }, [addTranscript]);

  // Stop camera helper
  const stopCamera = useCallback(() => {
    if (cameraIntervalRef.current) {
      clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamerRef.current?.destroy();
      clientRef.current?.disconnect();
      abortRef.current?.abort();
      stopCamera();
    };
  }, [stopCamera]);

  // ─── Gemini Live Event Handler ──────────────────────────────────────────
  const handleGeminiEvent = useCallback((event: GeminiLiveEvent) => {
    switch (event.type) {
      case "setupComplete":
        setState("listening");
        setError(null);
        addTranscript("system", "Connected");
        sessionStartRef.current = Date.now();
        break;
      case "audio":
        setState("speaking");
        // Route audio either to the 3D avatar (TalkingHead owns playback +
        // lipsync in one pipeline) or to the plain AudioStreamer fallback.
        if (avatarEnabled && avatarReady && avatarRef.current) {
          avatarRef.current.feedPcm(event.data);
        } else {
          streamerRef.current?.addPcm16Chunk(event.data);
        }
        break;
      case "text":
        setGeminiTextBuffer(prev => prev + event.text);
        break;
      case "inputTranscript":
        addTranscript("user", event.text);
        break;
      case "turnComplete":
        flushGeminiBuffer();
        avatarRef.current?.notifyEnd();
        // Gentle positive mood after a successful turn.
        avatarRef.current?.setMood("happy");
        setState("listening");
        break;
      case "interrupted":
        flushGeminiBuffer();
        streamerRef.current?.stop();
        avatarRef.current?.interrupt();
        setState("listening");
        break;
      case "error":
        setError(event.error);
        avatarRef.current?.setMood("sad");
        avatarRef.current?.playGesture("shrug", 2);
        setState("idle");
        break;
      case "closed":
        flushGeminiBuffer();
        setTranscript(currentTranscript => {
          const meaningful = currentTranscript.filter(e => e.role !== "system");
          if (meaningful.length >= 2) {
            const content = currentTranscript.map(e => `[${e.role}] ${e.text}`).join("\n");
            const title = `Conversation ${new Date().toLocaleDateString("en-US")} ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
            fetch("/api/gemini/tool-call", {
              method: "POST",
              headers: getAuthHeaders(),
              body: JSON.stringify({ name: "add_note", args: { title, content, tags: "gemini-live,conversation" } }),
            }).catch(() => {});
          }
          return currentTranscript;
        });
        setState("idle");
        recorderRef.current?.stop();
        stopCamera();
        break;
      case "toolCall": {
        setState("toolCall");
        const calls = event.calls;
        const friendlyNames = calls.map(c => friendlyToolName(c.name)).join(", ");
        setLastAction(friendlyNames);
        addTranscript("system", friendlyNames);
        // Play a gesture for the first tool call so the avatar reacts.
        if (calls.length > 0) {
          avatarRef.current?.playGesture(gestureForTool(calls[0].name), 2);
        }
        Promise.all(
          calls.map(async call => {
            const result = await executeToolCall(call);
            return { id: call.id, name: call.name, response: result };
          }),
        ).then(responses => {
          clientRef.current?.sendToolResponse(responses);
          setLastAction(null);
          setState("listening");
        }).catch(() => {
          setLastAction(null);
          setState("listening");
        });
        break;
      }
    }
  }, [addTranscript, flushGeminiBuffer, stopCamera, avatarEnabled, avatarReady]);

  // ─── Start Gemini Live Session ──────────────────────────────────────────
  const startGeminiLive = useCallback(async (resumeHistory?: Array<{ role: string; text: string }>) => {
    setError(null);
    setState("connecting");
    setExpanded(true);
    setTranscript(resumeHistory
      ? resumeHistory.map(m => ({ role: m.role as TranscriptEntry["role"], text: m.text, ts: Date.now() }))
      : []);
    setGeminiTextBuffer("");

    try {
      const res = await fetch("/api/gemini/config", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to get Gemini config");
      const { apiKey, voice, assistantName, userName, agents, recentConversations, activeSessions, contacts } = await res.json();
      if (!apiKey) throw new Error("Gemini API key not configured. Add it in Settings → Gemini.");
      if (assistantName) setDisplayName(assistantName);

      const [audioMod, clientMod] = await loadAudioModules();
      const streamer = new audioMod.AudioStreamer();
      streamerRef.current = streamer;
      const client = new clientMod.GeminiLiveClient(handleGeminiEvent);
      clientRef.current = client;
      client.connect(apiKey, voice || "Kore", { assistantName, userName, agents, recentConversations, activeSessions, contacts, resumeHistory });
      const recorder = new audioMod.AudioRecorder();
      recorderRef.current = recorder;
      await recorder.start((base64: string) => {
        if (client.isReady) client.sendAudio(base64);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }, [handleGeminiEvent]);

  // ─── Start Text Chat (SSE) ─────────────────────────────────────────────
  const sendTextChat = useCallback(async (userMessage: string, messageAttachments?: Attachment[]) => {
    if (!userMessage.trim() || !provider) return;

    // Mark session start on first text message so duration is recorded in Hank History.
    if (sessionStartRef.current === 0) sessionStartRef.current = Date.now();

    const hasAttachments = messageAttachments && messageAttachments.length > 0;
    addTranscript("user", userMessage, hasAttachments ? messageAttachments[0].dataUrl : undefined);

    if (hasAttachments) {
      // Build multimodal content
      const parts: Array<{ type: "text" | "image_url" | "document"; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: userMessage },
      ];
      for (const att of messageAttachments) {
        if (att.mimeType.startsWith("image/") && att.dataUrl) {
          parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
        }
      }
      conversationRef.current.push({ role: "user", content: parts });
    } else {
      conversationRef.current.push({ role: "user", content: userMessage });
    }
    setState("streaming");
    setGeminiTextBuffer("");

    try {
      const { streamChat } = await import("../lib/text-chat-client.js");
      let assistantText = "";

      const ctrl = streamChat(
        conversationRef.current.map(m => ({ role: m.role, content: m.content })),
        provider,
        modelOverride, // model override — empty string means server uses settings default
        (event: TextChatEvent) => {
          switch (event.type) {
            case "text":
              assistantText += event.content || "";
              setGeminiTextBuffer(assistantText);
              break;
            case "tool_call":
              setLastAction(friendlyToolName(event.name || ""));
              addTranscript("system", friendlyToolName(event.name || ""));
              avatarRef.current?.playGesture(gestureForTool(event.name || ""), 2);
              setState("toolCall");
              break;
            case "tool_result": {
              setLastAction(null);
              setState("streaming");
              // Show actionable link when agent finishes with drafts
              const toolName = event.name || "";
              const result = event.result as Record<string, unknown> | undefined;
              if (toolName === "run_agent" && result) {
                const status = result.status as string;
                const agentName = (result.agentName as string) || "Agent";
                if (status === "completed" || status === "still_running") {
                  const msg = status === "completed"
                    ? `${agentName} ist fertig!`
                    : `${agentName} arbeitet noch...`;
                  // Check if it's a content/social agent
                  const agentId = (result.agentId as string) || "";
                  const isContentAgent = agentId.includes("content") || agentName.toLowerCase().includes("content");
                  addTranscript("system", msg, undefined, isContentAgent
                    ? { label: "Drafts ansehen", href: "#/socialmedia/drafts" }
                    : { label: "Session ansehen", href: `#/sessions/${result.sessionId}` });
                }
              } else if (toolName === "prepare_social_post" && result) {
                addTranscript("system", "Draft erstellt", undefined,
                  { label: "Drafts ansehen", href: "#/socialmedia/drafts" });
              }
              break;
            }
            case "memory_added":
              if (event.fact) {
                addTranscript("system", `Remembered: ${event.fact}`);
              }
              break;
            case "session_event": {
              const evtName = event.event;
              let msg = "";
              if (evtName === "phase_changed") {
                const to = event.to || "";
                // Only show meaningful phase changes to the user.
                // "streaming" and "ready" toggle constantly during agent tool loops — skip them.
                if (to === "waiting_input" || to === "waiting_permission") msg = "Agent wartet auf Freigabe";
                else if (to === "initializing") msg = "Agent startet...";
                // Skip "streaming", "ready", "compacting" — these are internal phase changes
              } else if (evtName === "exited") {
                msg = event.exitCode === 0 ? "" : `Agent fehlgeschlagen (Exit Code ${event.exitCode})`;
              }
              if (msg) addTranscript("session_event", msg);
              break;
            }
            case "done":
              if (assistantText.trim()) {
                setGeminiTextBuffer("");
                addTranscript("assistant", assistantText.trim());
                conversationRef.current.push({ role: "assistant", content: assistantText.trim() });
              }
              assistantText = "";
              avatarRef.current?.setMood("happy");
              setState(isGeminiLive ? "listening" : "idle");
              break;
            case "error":
              setError(event.error || "Unknown error");
              avatarRef.current?.setMood("sad");
              avatarRef.current?.playGesture("shrug", 2);
              setState("idle");
              break;
          }
        },
      );
      abortRef.current = ctrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }, [provider, isGeminiLive, addTranscript, modelOverride]);

  // ─── Session Start (unified) ───────────────────────────────────────────
  const startSession = useCallback(async (resumeHistory?: Array<{ role: string; text: string }>) => {
    if (isGeminiLive) {
      return startGeminiLive(resumeHistory);
    }
    // Text providers: just expand the UI, ready for input
    setExpanded(true);
    setError(null);
    setTranscript([]);
    conversationRef.current = [];
    setGeminiTextBuffer("");
  }, [isGeminiLive, startGeminiLive]);

  // Listen for resume events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { messages?: Array<{ role: string; text: string }> } | undefined;
      if (detail?.messages && state === "idle") {
        startSession(detail.messages);
      }
    };
    window.addEventListener("gemini-resume", handler);
    return () => window.removeEventListener("gemini-resume", handler);
  }, [startSession, state]);

  const endSession = useCallback(() => {
    // Persist conversation (voice + text) so it appears in Hank History on the home screen.
    // After save we clear the transcript so reopening + re-ending doesn't create duplicates.
    let savedSomething = false;
    setTranscript(prev => {
      const meaningful = prev.filter(m => m.role === "user" || m.role === "assistant");
      if (meaningful.length >= 2) {
        const duration = sessionStartRef.current ? Math.round((Date.now() - sessionStartRef.current) / 1000) : undefined;
        // Filter to roles the server API accepts (user | gemini | system); drop session_event chatter.
        const payload = prev
          .filter(m => m.role === "user" || m.role === "assistant" || m.role === "system")
          .map(m => ({
            role: m.role === "assistant" ? "gemini" : m.role as "user" | "system",
            text: m.text,
            ts: m.ts,
          }));
        api.saveGeminiConversation(payload, duration).catch(() => {});
        savedSomething = true;
      }
      return savedSomething ? [] : prev;
    });
    sessionStartRef.current = 0;
    if (isGeminiLive) {
      recorderRef.current?.stop();
      recorderRef.current = null;
      streamerRef.current?.destroy();
      streamerRef.current = null;
      clientRef.current?.disconnect();
      clientRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    conversationRef.current = [];
    setState("idle");
    setError(null);
    setMuted(false);
    setLastAction(null);
    setGeminiTextBuffer("");
    setAvatarReady(false);
    stopCamera();
  }, [isGeminiLive, stopCamera]);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      if (recorderRef.current) recorderRef.current.muted = next;
      return next;
    });
  }, []);

  // ─── Text input: send ──────────────────────────────────────────────────
  const sendTextMessage = useCallback(() => {
    const msg = textInput.trim();
    if (!msg || provider === null) return;
    const currentAttachments = [...attachments];
    setTextInput("");
    setAttachments([]);
    // Reset textarea height
    if (textInputRef.current) textInputRef.current.style.height = "auto";

    if (isGeminiLive && clientRef.current?.isReady) {
      // Gemini Live: send as text to existing WebSocket
      clientRef.current.sendText(msg);
      addTranscript("user", msg, currentAttachments[0]?.dataUrl);
    } else if (!isGeminiLive) {
      // Text providers: send via SSE (with optional attachments)
      sendTextChat(msg, currentAttachments);
    }
  }, [textInput, isGeminiLive, addTranscript, sendTextChat, attachments]);

  // ─── File upload ───────────────────────────────────────────────────────
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    for (const file of Array.from(files)) {
      try {
        if (file.type.startsWith("image/") && isGeminiLive && clientRef.current?.isReady) {
          // Gemini Live: send directly via WebSocket
          const { base64, mimeType, dataUrl } = await fileToBase64(file);
          clientRef.current.sendImage(base64, mimeType);
          try {
            const upload = await api.uploadMedia(base64, mimeType, file.name);
            clientRef.current.sendText(`[Image uploaded and available at: ${upload.url}]`);
            addTranscript("user", `${file.name}`, dataUrl);
          } catch {
            addTranscript("user", `${file.name} (not saved)`, dataUrl);
          }
        } else if (file.type.startsWith("video/") && isGeminiLive && clientRef.current?.isReady) {
          addTranscript("system", `Processing video: ${file.name}...`);
          const dataUrl = URL.createObjectURL(file);
          const video = document.createElement("video");
          video.src = dataUrl;
          video.muted = true;
          await new Promise<void>(resolve => { video.onloadeddata = () => resolve(); video.load(); });
          const duration = video.duration;
          const frameCount = Math.min(5, Math.ceil(duration));
          for (let i = 0; i < frameCount; i++) {
            video.currentTime = (duration / frameCount) * i;
            await new Promise<void>(resolve => { video.onseeked = () => resolve(); });
            const frame = captureVideoFrame(video);
            clientRef.current?.sendImage(frame.base64, "image/jpeg");
          }
          URL.revokeObjectURL(dataUrl);
          addTranscript("user", `${file.name} (${frameCount} frames)`);
        } else if (file.type.startsWith("image/") && !isGeminiLive) {
          // Text providers: upload file and add as attachment
          const { dataUrl } = await fileToBase64(file);
          try {
            const formData = new FormData();
            formData.append("file", file);
            const resp = await fetch("/api/hank/chat/upload", {
              method: "POST",
              headers: getAuthHeaders(),
              body: formData,
            });
            if (resp.ok) {
              const data = await resp.json() as { url: string; absolutePath: string; mimeType: string; name: string };
              setAttachments(prev => [...prev, { url: data.url, absolutePath: data.absolutePath, mimeType: data.mimeType, name: data.name, dataUrl }]);
            } else {
              addTranscript("system", `Upload failed for ${file.name}`);
            }
          } catch {
            addTranscript("system", `Upload failed for ${file.name}`);
          }
        } else {
          // Other file types: upload and add as attachment
          try {
            const formData = new FormData();
            formData.append("file", file);
            const resp = await fetch("/api/hank/chat/upload", {
              method: "POST",
              headers: getAuthHeaders(),
              body: formData,
            });
            if (resp.ok) {
              const data = await resp.json() as { url: string; absolutePath: string; mimeType: string; name: string };
              setAttachments(prev => [...prev, { url: data.url, absolutePath: data.absolutePath, mimeType: data.mimeType, name: data.name }]);
            } else {
              addTranscript("system", `Upload failed for ${file.name}`);
            }
          } catch {
            addTranscript("system", `Upload failed for ${file.name}`);
          }
        }
      } catch (err) {
        addTranscript("system", `Failed to process ${file.name}`);
      }
    }
    e.target.value = "";
  }, [isGeminiLive, addTranscript]);

  // ─── Camera toggle ─────────────────────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    if (cameraActive) {
      stopCamera();
      addTranscript("system", "Camera stopped");
      return;
    }
    if (!isGeminiLive || !clientRef.current?.isReady) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      addTranscript("system", "Camera active — sending frames");
      cameraIntervalRef.current = setInterval(() => {
        if (videoRef.current && clientRef.current?.isReady && videoRef.current.readyState >= 2) {
          const { base64 } = captureVideoFrame(videoRef.current, 0.5);
          clientRef.current.sendImage(base64, "image/jpeg");
        }
      }, 2000);
    } catch {
      addTranscript("system", "Camera access denied or not available");
    }
  }, [cameraActive, isGeminiLive, stopCamera, addTranscript]);

  // ─── Provider switch ───────────────────────────────────────────────────
  const switchProvider = useCallback((newProvider: ChatProvider) => {
    if (state !== "idle" && !confirm("Switching providers will end your session. Continue?")) return;
    // Always call endSession: it persists the transcript (voice + text) and resets refs.
    // For text chat, state is often "idle" between messages, but the transcript still needs saving.
    endSession();
    setProvider(newProvider);
    setProviderDropdownOpen(false);
    // Save preference
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ hankChatProvider: newProvider }),
    }).catch(() => {});
  }, [state, endSession]);

  // Minimize / Close handlers
  const handleMinimize = useCallback(() => {
    setMicPos({ x: overlayPos.x + 360 - 56, y: overlayPos.y });
    setExpanded(false);
  }, [overlayPos, setMicPos]);

  const handleClose = useCallback(() => {
    // Always call endSession so text-chat transcripts get saved to Hank History,
    // even when state is "idle" (text chat rests in idle between messages).
    endSession();
    setExpanded(false);
  }, [endSession]);

  const isSessionActive = isGeminiLive
    ? state !== "idle"
    : transcript.length > 0 || state === "streaming" || state === "toolCall";

  // Auto-minimize overlay when navigating to non-chat pages (settings, agents, etc.)
  // so it doesn't block scrolling/interaction on those pages.
  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash;
      const isSessionPage = hash.startsWith("#/session/") || hash === "" || hash === "#" || hash === "#/";
      if (!isSessionPage && expanded) {
        setExpanded(false);
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [expanded]);

  // Overlay dimensions — responsive: cap at 360px but shrink on narrow viewports.
  // The 3D avatar adds ~260px when visible, so grow the max height accordingly.
  const avatarVisible = isGeminiLive && avatarEnabled && state !== "idle";
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  // On mobile, when the avatar is actively speaking we switch to an immersive
  // fullscreen layout — big face, floating controls — for a FaceTime-style feel.
  const isMobile = viewportWidth < 768;
  const immersive = isMobile && avatarVisible && (state === "speaking" || state === "listening");

  const overlayWidth = immersive
    ? viewportWidth
    : Math.min(360, viewportWidth - 16);
  const overlayMaxHeight = immersive
    ? viewportHeight
    : Math.min(
        (cameraActive ? 620 : 520) + (avatarVisible ? 260 : 0),
        viewportHeight - 40,
      );

  useEffect(() => {
    if (expanded && typeof window !== "undefined") {
      let ox = pos.x - overlayWidth + 56;
      let oy = pos.y - overlayMaxHeight - 8;
      if (ox < 8) ox = 8;
      if (oy < 8) oy = pos.y + 64;
      if (ox + overlayWidth > window.innerWidth - 8) ox = window.innerWidth - overlayWidth - 8;
      setOverlayPos({ x: ox, y: oy });
    }
  }, [expanded]);

  const clampedLeft = typeof window !== "undefined"
    ? Math.max(8, Math.min(overlayPos.x, window.innerWidth - overlayWidth - 8))
    : 8;
  const clampedTop = typeof window !== "undefined"
    ? Math.max(8, Math.min(overlayPos.y, window.innerHeight - 80))
    : 8;

  // ─── Collapsed: floating button ────────────────────────────────────────
  // Don't render anything until the user has authenticated
  if (!authenticated) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onPointerDown={onPointerDown}
        onClick={() => {
          if (didDrag()) return;
          if (providerLoading) return;
          if (isSessionActive) {
            setExpanded(true);
          } else {
            startSession();
          }
        }}
        className={`fixed z-[9999] w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-transform duration-200 hover:scale-105 active:scale-95 touch-none select-none ${
          isSessionActive
            ? "bg-green-600 hover:bg-green-500 text-white"
            : "bg-cc-primary hover:bg-cc-primary/90 text-white"
        }`}
        style={{ left: pos.x, top: pos.y }}
        title={isSessionActive ? `${displayName} — tap to expand` : `Hank (${provider ? PROVIDER_LABELS[provider] : "Loading..."})`}
        aria-label={isSessionActive ? "Open chat" : "Start chat"}
      >
        {isSessionActive && (
          <span className="absolute inset-0 rounded-full bg-green-500/40 animate-ping" style={{ animationDuration: "2s" }} />
        )}
        {isGeminiLive ? <MicIcon className="w-6 h-6 relative z-10" /> : <ChatIcon className="w-6 h-6 relative z-10" />}
        {isSessionActive && state === "speaking" && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-yellow-400 border-2 border-green-600" />
        )}
        {isSessionActive && (state === "toolCall" || state === "streaming") && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-blue-400 border-2 border-green-600 animate-pulse" />
        )}
        {isSessionActive && cameraActive && (
          <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-red-500 border-2 border-green-600" />
        )}
      </button>
    );
  }

  // ─── Expanded overlay ──────────────────────────────────────────────────
  return (
    <>
      <input ref={fileInputRef} type="file" accept="image/*,video/*,.pdf,.txt,.md,.json,.csv" multiple className="hidden" onChange={handleFileSelect} />

      <div
        className={`fixed z-[10000] bg-cc-bg shadow-2xl overflow-hidden flex flex-col ${
          immersive ? "inset-0 rounded-none border-0" : "rounded-xl border border-cc-border"
        }`}
        style={immersive
          ? { left: 0, top: 0, width: "100vw", height: "100vh", maxHeight: "100vh" }
          : { left: clampedLeft, top: clampedTop, width: overlayWidth, maxHeight: overlayMaxHeight }}
      >
        {/* Header — hidden on immersive mobile to maximize avatar */}
        {!immersive && <div
          onPointerDown={onOverlayPointerDown}
          className="flex items-center justify-between px-4 py-3 border-b border-cc-border bg-cc-card cursor-grab active:cursor-grabbing touch-none select-none"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2 h-2 rounded-full shrink-0 ${
              state === "idle" ? "bg-cc-muted"
                : state === "connecting" ? "bg-yellow-500 animate-pulse"
                : state === "toolCall" ? "bg-blue-500 animate-pulse"
                : state === "streaming" ? "bg-blue-500 animate-pulse"
                : "bg-green-500"
            }`} />
            <span className="text-sm font-medium text-cc-fg truncate">{displayName}</span>

            {/* Provider dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setProviderDropdownOpen(!providerDropdownOpen); }}
                className="text-[10px] px-2 py-0.5 rounded bg-cc-hover text-cc-muted hover:text-cc-fg transition-colors"
              >
                {provider ? PROVIDER_LABELS[provider] : "..."} ▾
              </button>
              {providerDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-cc-card border border-cc-border rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
                  {(Object.keys(PROVIDER_LABELS) as ChatProvider[]).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); switchProvider(p); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-cc-hover transition-colors ${
                        p === provider ? "text-cc-primary font-medium" : "text-cc-fg"
                      }`}
                    >
                      {PROVIDER_LABELS[p]}{providerKeyStatus[p] === false && <span title="API key required" className="ml-1 opacity-70">&#x1f512;</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Model override input */}
            <input
              type="text"
              value={modelOverride}
              onChange={(e) => {
                setModelOverride(e.target.value);
                // Debounced save to settings
                if (modelSaveTimerRef.current) clearTimeout(modelSaveTimerRef.current);
                const val = e.target.value;
                modelSaveTimerRef.current = setTimeout(() => {
                  fetch("/api/settings", {
                    method: "PATCH",
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ hankChatModel: val }),
                  }).catch(() => {});
                }, 500);
              }}
              placeholder="model"
              className="text-[10px] px-1.5 py-0.5 rounded bg-cc-hover text-cc-muted placeholder:text-cc-muted/50 border border-transparent focus:border-cc-border focus:text-cc-fg outline-none w-[80px] transition-colors"
              title="Model override (leave empty for default)"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="flex items-center gap-1">
            <button type="button" onClick={handleMinimize} className="text-cc-muted hover:text-cc-fg transition-colors p-1" title="Minimize">
              <MinimizeIcon className="w-4 h-4" />
            </button>
            <button type="button" onClick={handleClose} className="text-cc-muted hover:text-red-400 transition-colors p-1" title="End session">
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </div>}

        {/* 3D TalkingHead avatar (Gemini Live + enabled in settings) */}
        {isGeminiLive && avatarEnabled && state !== "idle" && (
          <div
            className={`relative bg-gradient-to-b from-cc-card to-cc-bg ${
              immersive ? "flex-1" : "border-b border-cc-border h-[260px]"
            }`}
          >
            <Suspense fallback={
              <div className="absolute inset-0 flex items-center justify-center text-xs text-cc-muted">
                Loading avatar...
              </div>
            }>
              <TalkingHeadAvatar
                ref={avatarRef}
                avatarUrl={avatarUrl}
                cameraView={immersive ? "head" : "upper"}
                onReady={() => setAvatarReady(true)}
                onError={() => setAvatarReady(false)}
              />
            </Suspense>
            {immersive && (
              <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none">
                <span className="px-3 py-1.5 rounded-full bg-black/40 text-white text-xs backdrop-blur-md">
                  {state === "speaking" ? `${displayName} speaking...` : muted ? "Muted" : "Listening..."}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Camera preview (Gemini Live only) */}
        {cameraActive && (
          <div className="relative border-b border-cc-border bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-28 object-cover" />
            <div className="absolute top-1.5 left-2 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] text-white/80 font-medium">LIVE</span>
            </div>
          </div>
        )}

        {/* Status bar — hidden on immersive (overlay label on avatar instead) */}
        {!immersive && <div className="flex items-center gap-3 px-4 py-2.5 border-b border-cc-border">
          <div className="flex-shrink-0">
            {state === "connecting" && <ConnectingAnimation />}
            {state === "listening" && <ListeningAnimation />}
            {state === "speaking" && <SpeakingAnimation />}
            {(state === "toolCall" || state === "streaming") && <StreamingAnimation />}
            {state === "idle" && (
              <div className="w-8 h-8 rounded-full border border-cc-border flex items-center justify-center">
                {isGeminiLive ? <MicIcon className="w-4 h-4 text-cc-muted" /> : <ChatIcon className="w-4 h-4 text-cc-muted" />}
              </div>
            )}
          </div>
          <span className="text-xs text-cc-muted">
            {state === "idle" && "Ready"}
            {state === "connecting" && "Connecting..."}
            {state === "listening" && (muted ? "Muted" : "Listening...")}
            {state === "speaking" && `${displayName} speaking...`}
            {state === "toolCall" && (lastAction ? `${lastAction}...` : "Action...")}
            {state === "streaming" && "Thinking..."}
          </span>
        </div>}

        {/* Transcript — hidden on immersive */}
        {!immersive && <div ref={transcriptRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-[100px] max-h-[260px]">
          {transcript.length === 0 && state !== "idle" && (
            <p className="text-xs text-cc-muted text-center py-4">
              {isGeminiLive ? "Say something..." : "Type a message..."}
            </p>
          )}
          {transcript.length === 0 && state === "idle" && !isGeminiLive && (
            <p className="text-xs text-cc-muted text-center py-4">
              Send a message to start chatting with {provider ? PROVIDER_LABELS[provider] : "..."}
            </p>
          )}
          {transcript.map((entry, i) => (
            entry.role === "session_event" ? (
              <div key={i} className="flex justify-center">
                <div className={`px-3 py-1 text-[10px] rounded-full ${
                  /error|fail|denied|refused/i.test(entry.text)
                    ? "bg-red-500/20 text-red-400"
                    : "text-cc-muted bg-cc-hover"
                }`}>
                  {entry.text}
                </div>
              </div>
            ) : (
              <div key={i} className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-xs ${
                  entry.role === "user"
                    ? "bg-cc-primary/20 text-cc-fg"
                    : entry.role === "system"
                      ? "bg-cc-hover text-cc-muted italic"
                      : "bg-cc-card text-cc-fg border border-cc-border"
                }`}>
                  {entry.imageUrl && (
                    <img src={entry.imageUrl} alt="" className="w-full max-h-24 object-cover rounded mb-1" />
                  )}
                  {entry.text}
                  {entry.link && (
                    <a
                      href={entry.link.href}
                      className="mt-1.5 flex items-center gap-1 px-2.5 py-1 rounded bg-cc-primary/20 text-cc-primary hover:bg-cc-primary/30 transition-colors text-[11px] font-medium no-underline w-fit"
                    >
                      {entry.link.label} →
                    </a>
                  )}
                </div>
              </div>
            )
          ))}
          {geminiTextBuffer && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg px-3 py-1.5 text-xs bg-cc-card text-cc-fg border border-cc-border opacity-60">
                {geminiTextBuffer}
              </div>
            </div>
          )}
        </div>}

        {/* Text input — always shown for text providers, shown during active session for Gemini Live, hidden on immersive mobile */}
        {!immersive && (state !== "idle" || !isGeminiLive) && (
          <div className="px-3 py-2 border-t border-cc-border">
            {/* Attachment previews */}
            {attachments.length > 0 && (
              <div className="flex gap-1.5 mb-1.5 flex-wrap">
                {attachments.map((att, i) => (
                  <div key={i} className="relative group">
                    {att.dataUrl ? (
                      <img src={att.dataUrl} alt={att.name} className="w-12 h-12 rounded object-cover border border-cc-border" />
                    ) : (
                      <div className="w-12 h-12 rounded border border-cc-border bg-cc-hover flex items-center justify-center text-[9px] text-cc-muted truncate px-0.5">
                        {att.name.split(".").pop()}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1.5 items-end">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg bg-cc-hover text-cc-muted hover:text-cc-fg hover:bg-cc-border transition-colors shrink-0"
                title="Attach file"
                disabled={state === "streaming" || state === "toolCall"}
              >
                <ImageIcon className="w-3.5 h-3.5" />
              </button>
              <textarea
                ref={textInputRef}
                value={textInput}
                onChange={e => {
                  setTextInput(e.target.value);
                  // Auto-resize
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } }}
                placeholder={isGeminiLive ? "Type a message..." : `Message ${provider ? PROVIDER_LABELS[provider] : "..."}...`}
                className="flex-1 px-2.5 py-1.5 text-xs bg-cc-bg rounded-lg border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-primary resize-none"
                rows={1}
                style={{ maxHeight: "120px", overflowY: "auto" }}
                disabled={state === "streaming" || state === "toolCall"}
              />
              <button
                type="button"
                onClick={sendTextMessage}
                disabled={(!textInput.trim() && attachments.length === 0) || state === "streaming" || state === "toolCall"}
                className="px-2.5 py-1.5 rounded-lg bg-cc-primary text-white text-xs disabled:opacity-30 hover:bg-cc-primary-hover transition-colors shrink-0"
                title="Send"
              >
                <SendIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-3 py-2 border-t border-cc-border">
            <p className="text-xs text-red-400 text-center break-words">{error}</p>
          </div>
        )}

        {/* Controls — absolute floating bar on immersive, normal footer otherwise */}
        <div
          className={
            immersive
              ? "absolute left-0 right-0 bottom-0 pb-8 pt-6 px-6 flex items-center justify-center gap-3 bg-gradient-to-t from-black/60 to-transparent"
              : "flex items-center justify-center gap-2 px-4 py-3 border-t border-cc-border"
          }
        >
          {immersive && (
            <button
              type="button"
              onClick={handleMinimize}
              className="p-3 rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/25 transition-colors"
              title="Back to compact view"
            >
              <MinimizeIcon className="w-5 h-5" />
            </button>
          )}
          {isGeminiLive ? (
            state === "idle" ? (
              <button
                type="button"
                onClick={() => startSession()}
                className="px-4 py-2 rounded-lg bg-cc-primary text-white text-sm font-medium hover:bg-cc-primary/90 transition-colors"
              >
                Start Voice
              </button>
            ) : (
              <>
                <button type="button" onClick={endSession} className="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors">
                  End
                </button>
                <button
                  type="button"
                  onClick={toggleMute}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    muted ? "bg-yellow-600 text-white hover:bg-yellow-700" : "bg-cc-hover text-cc-fg hover:bg-cc-border"
                  }`}
                >
                  {muted ? "Unmute" : "Mute"}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 rounded-lg bg-cc-hover text-cc-fg hover:bg-cc-border transition-colors"
                  title="Send image or video"
                >
                  <ImageIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={toggleCamera}
                  className={`p-2 rounded-lg transition-colors ${
                    cameraActive ? "bg-red-600 text-white hover:bg-red-700" : "bg-cc-hover text-cc-fg hover:bg-cc-border"
                  }`}
                  title={cameraActive ? "Stop camera" : "Start camera"}
                >
                  <CameraIcon className="w-4 h-4" />
                </button>
              </>
            )
          ) : (
            // Text provider controls
            isSessionActive && (
              <button type="button" onClick={endSession} className="px-3 py-2 rounded-lg bg-cc-hover text-cc-fg text-xs font-medium hover:bg-cc-border transition-colors">
                Clear Chat
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MinimizeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

// ─── Animations ──────────────────────────────────────────────────────────────

function ConnectingAnimation() {
  return (
    <div className="w-8 h-8 rounded-full border border-cc-border flex items-center justify-center">
      <div className="w-5 h-5 rounded-full border-2 border-t-cc-primary border-r-transparent border-b-transparent border-l-transparent animate-spin" />
    </div>
  );
}

function ListeningAnimation() {
  return (
    <div className="relative w-8 h-8 flex items-center justify-center">
      <div className="absolute inset-0 rounded-full bg-cc-primary/20 animate-ping" style={{ animationDuration: "2s" }} />
      <div className="relative w-6 h-6 rounded-full bg-cc-primary/30 flex items-center justify-center">
        <MicIcon className="w-3 h-3 text-cc-primary" />
      </div>
    </div>
  );
}

function SpeakingAnimation() {
  return (
    <div className="flex items-center justify-center gap-0.5 w-8 h-8">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-1 rounded-full bg-cc-primary"
          style={{ animation: "voiceBarSmall 0.8s ease-in-out infinite", animationDelay: `${i * 0.15}s`, height: "4px" }}
        />
      ))}
      <style>{`@keyframes voiceBarSmall { 0%, 100% { height: 4px; } 50% { height: 14px; } }`}</style>
    </div>
  );
}

function StreamingAnimation() {
  return (
    <div className="w-8 h-8 rounded-full border border-blue-500/30 flex items-center justify-center bg-blue-500/10">
      <svg className="w-4 h-4 text-blue-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    </div>
  );
}
