// ─── VoiceChat ───────────────────────────────────────────────────────────────
// Floating voice chat overlay for Gemini Live audio conversations.
// Supports function calling, image/file upload, and live camera.
// Draggable + collapsible without losing context/session.

import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "../api.js";

type VoiceChatState = "idle" | "connecting" | "listening" | "speaking" | "toolCall";

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
  add_todo: "Add task",
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
};

function friendlyToolName(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, " ");
}

interface TranscriptEntry {
  role: "user" | "gemini" | "system";
  text: string;
  ts: number;
  imageUrl?: string; // data URL for sent images
}

// Lazy-load audio/client modules to avoid issues with browser-only APIs at import time
const loadAudioModules = () => Promise.all([
  import("../lib/gemini-audio.js"),
  import("../lib/gemini-live-client.js"),
] as const);

type AudioRecorderType = import("../lib/gemini-audio.js").AudioRecorder;
type AudioStreamerType = import("../lib/gemini-audio.js").AudioStreamer;
type GeminiLiveClientType = import("../lib/gemini-live-client.js").GeminiLiveClient;
type GeminiLiveEvent = import("../lib/gemini-live-client.js").GeminiLiveEvent;
type GeminiToolCall = import("../lib/gemini-live-client.js").GeminiToolCall;

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

/** Convert a File to base64 (without data: prefix) and its mime type */
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

/** Capture a frame from a video element as JPEG base64 */
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

/** Draggable position hook for both mouse and touch.
 *  Tracks the overlay's top-left corner directly. */
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

export function VoiceChat() {
  const [state, setState] = useState<VoiceChatState>("idle");
  const [expanded, setExpanded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [geminiTextBuffer, setGeminiTextBuffer] = useState("");
  const [displayName, setDisplayName] = useState("Gemini Live");
  const [cameraActive, setCameraActive] = useState(false);
  const [textInput, setTextInput] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recorderRef = useRef<AudioRecorderType | null>(null);
  const streamerRef = useRef<AudioStreamerType | null>(null);
  const clientRef = useRef<GeminiLiveClientType | null>(null);
  const sessionStartRef = useRef<number>(0);

  // Draggable position for collapsed mic button — start at bottom-right
  const { pos, setPos: setMicPos, onPointerDown, didDrag } = useDraggable(
    typeof window !== "undefined" ? window.innerWidth - 80 : 0,
    typeof window !== "undefined" ? window.innerHeight - 80 : 0,
  );

  // Draggable position for expanded overlay panel
  const { pos: overlayPos, onPointerDown: onOverlayPointerDown, setPos: setOverlayPos } = useDraggable(
    typeof window !== "undefined" ? window.innerWidth - 340 : 0,
    typeof window !== "undefined" ? Math.max(20, window.innerHeight - 520) : 0,
  );

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript, geminiTextBuffer]);

  const addTranscript = useCallback((role: TranscriptEntry["role"], text: string, imageUrl?: string) => {
    setTranscript((prev) => [...prev.slice(-50), { role, text, ts: Date.now(), imageUrl }]);
  }, []);

  const flushGeminiBuffer = useCallback(() => {
    setGeminiTextBuffer((buf) => {
      if (buf.trim()) {
        addTranscript("gemini", buf.trim());
      }
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
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
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
      stopCamera();
    };
  }, [stopCamera]);

  const handleEvent = useCallback((event: GeminiLiveEvent) => {
    console.log("[VoiceChat] event:", event.type, event.type === "error" ? (event as { error?: string }).error : "", event.type === "closed" ? "ws-closed" : "");
    switch (event.type) {
      case "setupComplete":
        setState("listening");
        setError(null);
        addTranscript("system", "Connected");
        sessionStartRef.current = Date.now();
        break;
      case "audio":
        setState("speaking");
        streamerRef.current?.addPcm16Chunk(event.data);
        break;
      case "text":
        setGeminiTextBuffer((prev) => prev + event.text);
        break;
      case "inputTranscript":
        addTranscript("user", event.text);
        break;
      case "turnComplete":
        flushGeminiBuffer();
        setState("listening");
        break;
      case "interrupted":
        flushGeminiBuffer();
        streamerRef.current?.stop();
        setState("listening");
        break;
      case "error":
        setError(event.error);
        setState("idle");
        break;
      case "closed":
        flushGeminiBuffer();
        setTranscript((currentTranscript) => {
          const meaningful = currentTranscript.filter((e) => e.role !== "system");
          if (meaningful.length >= 2) {
            const content = currentTranscript
              .map((e) => `[${e.role}] ${e.text}`)
              .join("\n");
            const title = `Conversation ${new Date().toLocaleDateString("en-US")} ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
            fetch("/api/gemini/tool-call", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...getAuthHeaders() },
              body: JSON.stringify({
                name: "add_note",
                args: { title, content, tags: "gemini-live,conversation" },
              }),
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
        const friendlyNames = calls.map((c) => friendlyToolName(c.name)).join(", ");
        setLastAction(friendlyNames);
        addTranscript("system", friendlyNames);

        Promise.all(
          calls.map(async (call) => {
            const result = await executeToolCall(call);
            return { id: call.id, name: call.name, response: result };
          }),
        ).then((responses) => {
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
  }, [addTranscript, flushGeminiBuffer, stopCamera]);

  const startSession = useCallback(async (resumeHistory?: Array<{ role: string; text: string }>) => {
    setError(null);
    setState("connecting");
    setExpanded(true);
    setTranscript(resumeHistory
      ? resumeHistory.map((m) => ({ role: m.role as TranscriptEntry["role"], text: m.text, ts: Date.now() }))
      : []);
    setGeminiTextBuffer("");

    try {
      const res = await fetch("/api/gemini/config", {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        throw new Error("Failed to get Gemini config");
      }
      const { apiKey, voice, assistantName, userName, agents, recentConversations, activeSessions, contacts } = await res.json();
      if (!apiKey) {
        throw new Error("Gemini API key not configured. Add it in Settings → Gemini.");
      }
      if (assistantName) setDisplayName(`${assistantName} Live`);

      const [audioMod, clientMod] = await loadAudioModules();

      const streamer = new audioMod.AudioStreamer();
      streamerRef.current = streamer;

      const client = new clientMod.GeminiLiveClient(handleEvent);
      clientRef.current = client;
      client.connect(apiKey, voice || "Kore", { assistantName, userName, agents, recentConversations, activeSessions, contacts, resumeHistory });

      const recorder = new audioMod.AudioRecorder();
      recorderRef.current = recorder;

      await recorder.start((base64: string) => {
        if (client.isReady) {
          client.sendAudio(base64);
        }
      });

    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error("[VoiceChat] startSession error:", err);
      setError(msg);
      setState("idle");
    }
  }, [handleEvent]);

  // Listen for resume events from other components (e.g. dashboard "Continue" button)
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
    // Save conversation history if there are user/gemini messages
    setTranscript((prev) => {
      const meaningful = prev.filter((m) => m.role === "user" || m.role === "gemini");
      if (meaningful.length >= 2) {
        const duration = sessionStartRef.current ? Math.round((Date.now() - sessionStartRef.current) / 1000) : undefined;
        api.saveGeminiConversation(
          prev.map((m) => ({ role: m.role, text: m.text, ts: m.ts })),
          duration,
        ).catch(() => {});
      }
      return prev;
    });
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamerRef.current?.destroy();
    streamerRef.current = null;
    clientRef.current?.disconnect();
    clientRef.current = null;
    setState("idle");
    setError(null);
    setMuted(false);
    setLastAction(null);
    setGeminiTextBuffer("");
    stopCamera();
  }, [stopCamera]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (recorderRef.current) {
        recorderRef.current.muted = next;
      }
      return next;
    });
  }, []);

  // ─── Text input ──────────────────────────────────────────────────────────
  const sendTextMessage = useCallback(() => {
    const msg = textInput.trim();
    if (!msg || !clientRef.current?.isReady) return;
    clientRef.current.sendText(msg);
    addTranscript("user", msg);
    setTextInput("");
  }, [textInput, addTranscript]);

  // ─── Media Input: File upload ──────────────────────────────────────────────
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !clientRef.current?.isReady) return;

    for (const file of Array.from(files)) {
      try {
        // Images: send to Gemini + upload to server for media library
        if (file.type.startsWith("image/")) {
          const { base64, mimeType, dataUrl } = await fileToBase64(file);
          clientRef.current.sendImage(base64, mimeType);
          // Upload to server so the image can be referenced in social media drafts
          try {
            const upload = await api.uploadMedia(base64, mimeType, file.name);
            // Tell Gemini the image URL so it can use it in posts
            clientRef.current.sendText(`[Image uploaded and available at: ${upload.url}]`);
            addTranscript("user", `📷 ${file.name}`, dataUrl);
          } catch {
            addTranscript("user", `📷 ${file.name} (not saved to server)`, dataUrl);
          }
        }
        // Videos: extract frames and send
        else if (file.type.startsWith("video/")) {
          addTranscript("system", `Processing video: ${file.name}...`);
          const dataUrl = URL.createObjectURL(file);
          const video = document.createElement("video");
          video.src = dataUrl;
          video.muted = true;
          await new Promise<void>((resolve) => {
            video.onloadeddata = () => resolve();
            video.load();
          });
          // Extract up to 5 evenly spaced frames
          const duration = video.duration;
          const frameCount = Math.min(5, Math.ceil(duration));
          for (let i = 0; i < frameCount; i++) {
            video.currentTime = (duration / frameCount) * i;
            await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
            const frame = captureVideoFrame(video);
            clientRef.current?.sendImage(frame.base64, "image/jpeg");
          }
          URL.revokeObjectURL(dataUrl);
          addTranscript("user", `🎬 ${file.name} (${frameCount} frames)`);
        }
        // PDFs / Documents: render first page as image via canvas
        else if (file.type === "application/pdf") {
          addTranscript("system", `PDF support requires rendering — sending as filename reference`);
          // For now, notify user; full PDF rendering would need pdf.js
          addTranscript("user", `📄 ${file.name} (PDF — tell Gemini what to look at)`);
        }
        // Other: try as image anyway
        else {
          const { base64, mimeType, dataUrl } = await fileToBase64(file);
          clientRef.current.sendImage(base64, mimeType);
          addTranscript("user", `📎 ${file.name}`, dataUrl);
        }
      } catch (err) {
        console.error("[VoiceChat] File processing error:", err);
        addTranscript("system", `Failed to process ${file.name}`);
      }
    }

    // Reset input so same file can be selected again
    e.target.value = "";
  }, [addTranscript]);

  // ─── Media Input: Camera toggle ────────────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    if (cameraActive) {
      stopCamera();
      addTranscript("system", "Camera stopped");
      return;
    }

    if (!clientRef.current?.isReady) return;

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

      // Send a frame every 2 seconds
      cameraIntervalRef.current = setInterval(() => {
        if (videoRef.current && clientRef.current?.isReady && videoRef.current.readyState >= 2) {
          const { base64 } = captureVideoFrame(videoRef.current, 0.5);
          clientRef.current.sendImage(base64, "image/jpeg");
        }
      }, 2000);

    } catch (err) {
      console.error("[VoiceChat] Camera error:", err);
      addTranscript("system", "Camera access denied or not available");
    }
  }, [cameraActive, stopCamera, addTranscript]);

  // Minimize: collapse UI but keep session alive.
  // Move the mic button to where the overlay was so it doesn't jump away.
  const handleMinimize = useCallback(() => {
    // Place mic button at top-right corner of overlay
    setMicPos({ x: overlayPos.x + 320 - 56, y: overlayPos.y });
    setExpanded(false);
  }, [overlayPos, setMicPos]);

  // Close: end session AND collapse
  const handleClose = useCallback(() => {
    if (state !== "idle") {
      endSession();
    }
    setExpanded(false);
  }, [state, endSession]);

  const isSessionActive = state !== "idle";

  // Overlay dimensions
  const overlayWidth = 320;
  const overlayMaxHeight = typeof window !== "undefined"
    ? Math.min(cameraActive ? 580 : 480, window.innerHeight - 40)
    : 480;

  // When expanding, position overlay near the mic button
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

  // Clamp overlay position
  const clampedLeft = typeof window !== "undefined"
    ? Math.max(8, Math.min(overlayPos.x, window.innerWidth - overlayWidth - 8))
    : 8;
  const clampedTop = typeof window !== "undefined"
    ? Math.max(8, Math.min(overlayPos.y, window.innerHeight - 80))
    : 8;

  // Collapsed state: floating mic button (draggable)
  if (!expanded) {
    return (
      <button
        type="button"
        onPointerDown={onPointerDown}
        onClick={() => {
          if (didDrag()) return;
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
        title={isSessionActive ? `${displayName} — tap to expand` : "Gemini Voice Chat"}
      >
        {isSessionActive && (
          <span className="absolute inset-0 rounded-full bg-green-500/40 animate-ping" style={{ animationDuration: "2s" }} />
        )}
        <MicIcon className="w-6 h-6 relative z-10" />
        {isSessionActive && state === "speaking" && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-yellow-400 border-2 border-green-600" />
        )}
        {isSessionActive && state === "toolCall" && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-blue-400 border-2 border-green-600 animate-pulse" />
        )}
        {isSessionActive && cameraActive && (
          <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-red-500 border-2 border-green-600" />
        )}
      </button>
    );
  }

  // Expanded overlay
  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,.pdf"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Overlay panel */}
      <div
        className="fixed z-[10000] rounded-xl border border-cc-border bg-cc-bg shadow-2xl overflow-hidden flex flex-col"
        style={{ left: clampedLeft, top: clampedTop, width: overlayWidth, maxHeight: overlayMaxHeight }}
      >
        {/* Header — drag handle */}
        <div
          onPointerDown={onOverlayPointerDown}
          className="flex items-center justify-between px-4 py-3 border-b border-cc-border bg-cc-card cursor-grab active:cursor-grabbing touch-none select-none">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${state === "idle" ? "bg-cc-muted" : state === "connecting" ? "bg-yellow-500 animate-pulse" : state === "toolCall" ? "bg-blue-500 animate-pulse" : "bg-green-500"}`} />
            <span className="text-sm font-medium text-cc-fg">{displayName}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleMinimize}
              className="text-cc-muted hover:text-cc-fg transition-colors p-1"
              title="Minimize (keep session)"
            >
              <MinimizeIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="text-cc-muted hover:text-red-400 transition-colors p-1"
              title="End session"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Camera preview */}
        {cameraActive && (
          <div className="relative border-b border-cc-border bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-28 object-cover"
            />
            <div className="absolute top-1.5 left-2 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] text-white/80 font-medium">LIVE</span>
            </div>
          </div>
        )}

        {/* Animated indicator + status */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-cc-border">
          <div className="flex-shrink-0">
            {state === "connecting" && <ConnectingAnimationSmall />}
            {state === "listening" && <ListeningAnimationSmall />}
            {state === "speaking" && <SpeakingAnimationSmall />}
            {state === "toolCall" && <ToolCallAnimationSmall />}
            {state === "idle" && (
              <div className="w-8 h-8 rounded-full border border-cc-border flex items-center justify-center">
                <MicIcon className="w-4 h-4 text-cc-muted" />
              </div>
            )}
          </div>
          <span className="text-xs text-cc-muted">
            {state === "idle" && "Ready"}
            {state === "connecting" && "Connecting..."}
            {state === "listening" && (muted ? "Muted" : "Listening...")}
            {state === "speaking" && `${displayName.replace(" Live", "")} speaking...`}
            {state === "toolCall" && (lastAction ? `${lastAction}...` : "Action...")}
          </span>
        </div>

        {/* Transcript */}
        <div
          ref={transcriptRef}
          className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-[100px] max-h-[240px]"
        >
          {transcript.length === 0 && state !== "idle" && (
            <p className="text-xs text-cc-muted text-center py-4">Say something...</p>
          )}
          {transcript.map((entry, i) => (
            <div key={i} className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-1.5 text-xs ${
                  entry.role === "user"
                    ? "bg-cc-primary/20 text-cc-fg"
                    : entry.role === "system"
                      ? "bg-cc-hover text-cc-muted italic"
                      : "bg-cc-card text-cc-fg border border-cc-border"
                }`}
              >
                {entry.imageUrl && (
                  <img src={entry.imageUrl} alt="" className="w-full max-h-24 object-cover rounded mb-1" />
                )}
                {entry.text}
              </div>
            </div>
          ))}
          {/* Live gemini text buffer */}
          {geminiTextBuffer && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg px-3 py-1.5 text-xs bg-cc-card text-cc-fg border border-cc-border opacity-60">
                {geminiTextBuffer}
              </div>
            </div>
          )}
        </div>

        {/* Text input */}
        {state !== "idle" && (
          <div className="px-3 py-2 border-t border-cc-border">
            <div className="flex gap-1.5">
              <input
                ref={textInputRef}
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } }}
                placeholder="Type a message..."
                className="flex-1 px-2.5 py-1.5 text-xs bg-cc-bg rounded-lg border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-primary"
              />
              <button
                type="button"
                onClick={sendTextMessage}
                disabled={!textInput.trim()}
                className="px-2.5 py-1.5 rounded-lg bg-cc-primary text-white text-xs disabled:opacity-30 hover:bg-cc-primary-hover transition-colors"
                title="Send text message"
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

        {/* Controls */}
        <div className="flex items-center justify-center gap-2 px-4 py-3 border-t border-cc-border">
          {state === "idle" ? (
            <button
              type="button"
              onClick={startSession}
              className="px-4 py-2 rounded-lg bg-cc-primary text-white text-sm font-medium hover:bg-cc-primary/90 transition-colors"
            >
              Start
            </button>
          ) : (
            <>
              {/* End session */}
              <button
                type="button"
                onClick={endSession}
                className="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors"
              >
                End
              </button>
              {/* Mute */}
              <button
                type="button"
                onClick={toggleMute}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  muted
                    ? "bg-yellow-600 text-white hover:bg-yellow-700"
                    : "bg-cc-hover text-cc-fg hover:bg-cc-border"
                }`}
              >
                {muted ? "Unmute" : "Mute"}
              </button>
              {/* Upload image/file */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-lg bg-cc-hover text-cc-fg hover:bg-cc-border transition-colors"
                title="Send image, video or file"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              {/* Camera toggle */}
              <button
                type="button"
                onClick={toggleCamera}
                className={`p-2 rounded-lg transition-colors ${
                  cameraActive
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-cc-hover text-cc-fg hover:bg-cc-border"
                }`}
                title={cameraActive ? "Stop camera" : "Start camera"}
              >
                <CameraIcon className="w-4 h-4" />
              </button>
            </>
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

// ─── Small Animations (for inline status) ────────────────────────────────────

function ConnectingAnimationSmall() {
  return (
    <div className="w-8 h-8 rounded-full border border-cc-border flex items-center justify-center">
      <div className="w-5 h-5 rounded-full border-2 border-t-cc-primary border-r-transparent border-b-transparent border-l-transparent animate-spin" />
    </div>
  );
}

function ListeningAnimationSmall() {
  return (
    <div className="relative w-8 h-8 flex items-center justify-center">
      <div className="absolute inset-0 rounded-full bg-cc-primary/20 animate-ping" style={{ animationDuration: "2s" }} />
      <div className="relative w-6 h-6 rounded-full bg-cc-primary/30 flex items-center justify-center">
        <MicIcon className="w-3 h-3 text-cc-primary" />
      </div>
    </div>
  );
}

function SpeakingAnimationSmall() {
  return (
    <div className="flex items-center justify-center gap-0.5 w-8 h-8">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1 rounded-full bg-cc-primary"
          style={{
            animation: "voiceBarSmall 0.8s ease-in-out infinite",
            animationDelay: `${i * 0.15}s`,
            height: "4px",
          }}
        />
      ))}
      <style>{`
        @keyframes voiceBarSmall {
          0%, 100% { height: 4px; }
          50% { height: 14px; }
        }
      `}</style>
    </div>
  );
}

function ToolCallAnimationSmall() {
  return (
    <div className="w-8 h-8 rounded-full border border-blue-500/30 flex items-center justify-center bg-blue-500/10">
      <svg className="w-4 h-4 text-blue-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    </div>
  );
}
