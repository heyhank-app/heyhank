import { useState } from "react";

// ─── Section Component ──────────────────────────────────────────────────────

function Section({
  id,
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  id: string;
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={id} className="border border-cc-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-cc-hover/50 transition-colors"
      >
        <span className="text-xl shrink-0">{icon}</span>
        <span className="text-sm font-semibold text-cc-fg flex-1">{title}</span>
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`w-4 h-4 text-cc-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-cc-muted leading-relaxed space-y-3 border-t border-cc-border/50">
          <div className="pt-4" />
          {children}
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 rounded bg-cc-card border border-cc-border text-[11px] font-mono text-cc-fg">
      {children}
    </kbd>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="shrink-0 w-6 h-6 rounded-full bg-cc-primary/20 text-cc-primary text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="text-xs bg-cc-card px-1 rounded">{children}</code>
  );
}

// ─── Quick Nav ──────────────────────────────────────────────────────────────

function QuickNav() {
  const sections = [
    { id: "overview", label: "Overview" },
    { id: "first-steps", label: "Getting Started" },
    { id: "gemini-live", label: "Gemini Live" },
    { id: "agents", label: "Agents" },
    { id: "sessions", label: "Sessions & Chat" },
    { id: "media", label: "Media Generation" },
    { id: "telephony", label: "Telephony" },
    { id: "federation", label: "Federation" },
    { id: "sidebar", label: "Sidebar & Navigation" },
    { id: "platform", label: "Platform Dashboard" },
    { id: "pwa", label: "PWA & Mobile" },
    { id: "keyboard", label: "Keyboard Shortcuts" },
    { id: "tailscale", label: "Tailscale Setup" },
    { id: "api", label: "API Reference" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#/help?s=${s.id}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className="px-3 py-1.5 rounded-lg bg-cc-card border border-cc-border text-xs text-cc-muted hover:text-cc-fg hover:border-cc-primary/50 transition-colors"
        >
          {s.label}
        </a>
      ))}
    </div>
  );
}

// ─── Main Help Page ─────────────────────────────────────────────────────────

export function HelpPage() {
  return (
    <div className="h-full overflow-y-auto bg-cc-bg">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-safe space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-cc-fg">HeyHank Help</h1>
          <p className="text-sm text-cc-muted mt-1">
            Self-hosted AI agent platform with voice assistant, telephony, media generation and multi-node federation.
          </p>
        </div>

        <QuickNav />

        {/* ─── Overview ─── */}
        <Section id="overview" title="Overview" icon="&#x1F3E0;" defaultOpen>
          <p>
            HeyHank is your self-hosted AI agent platform. Create custom agents with any LLM backend,
            talk to them via Gemini Live voice, make phone calls through SIP, generate images and videos,
            and connect multiple HeyHank instances together.
          </p>

          <h4 className="font-semibold text-cc-fg mt-2">Key Features</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
            {[
              { name: "Custom Agents", desc: "Create unlimited agents", color: "text-blue-400" },
              { name: "Gemini Live", desc: "Voice assistant", color: "text-green-400" },
              { name: "Telephony", desc: "AI phone calls via SIP", color: "text-purple-400" },
              { name: "Media Gen", desc: "Images & videos", color: "text-pink-400" },
              { name: "Federation", desc: "Multi-node mesh", color: "text-yellow-400" },
              { name: "Multi-LLM", desc: "Claude, Gemini, Ollama", color: "text-orange-400" },
            ].map((a) => (
              <div key={a.name} className="rounded-lg bg-cc-card p-3 border border-cc-border/50">
                <div className={`text-xs font-semibold ${a.color}`}>{a.name}</div>
                <div className="text-[11px] text-cc-muted mt-0.5">{a.desc}</div>
              </div>
            ))}
          </div>
          <p className="mt-2">
            <strong className="text-cc-fg">LLM Backends:</strong> Claude Code CLI (Max subscription or API),
            Ollama (local, free), Gemini API, Codex CLI — configurable per agent.
          </p>
        </Section>

        {/* ─── Getting Started ─── */}
        <Section id="first-steps" title="Getting Started" icon="&#x1F680;">
          <Step n={1}>
            <p><strong className="text-cc-fg">Install</strong> — <Code>npx heyhank</Code> or <Code>bunx heyhank</Code>. HeyHank starts on port 3100 by default.</p>
          </Step>
          <Step n={2}>
            <p><strong className="text-cc-fg">Log in</strong> — Open the URL and enter the auth token shown in the terminal.</p>
          </Step>
          <Step n={3}>
            <p><strong className="text-cc-fg">Start a session</strong> — Click <strong className="text-cc-fg">+ New Session</strong> in the sidebar. Choose a working directory and backend (Claude/Codex).</p>
          </Step>
          <Step n={4}>
            <p><strong className="text-cc-fg">Chat</strong> — Type your message and press <Kbd>Enter</Kbd>. The agent responds with text, executes tools, and asks for permission when needed.</p>
          </Step>
          <Step n={5}>
            <p><strong className="text-cc-fg">Create an agent</strong> — Go to <strong className="text-cc-fg">Agents</strong> in the sidebar, click <strong className="text-cc-fg">+ New Agent</strong>. Give it a name, prompt, model, and working directory.</p>
          </Step>
          <Step n={6}>
            <p><strong className="text-cc-fg">Talk to Gemini</strong> — Click the microphone button (bottom right) to start a voice conversation with Gemini Live. It can control your agents, make calls, and more.</p>
          </Step>
        </Section>

        {/* ─── Gemini Live ─── */}
        <Section id="gemini-live" title="Gemini Live — Voice Assistant" icon="&#x1F399;">
          <p>
            Gemini Live is your always-available voice interface. It uses Google's BidiGenerateContent API
            for real-time bidirectional audio streaming — you talk, it responds instantly with voice.
          </p>

          <h4 className="font-semibold text-cc-fg mt-2">How to use</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Click the <strong className="text-cc-fg">microphone button</strong> (floating, bottom right) to start.</li>
            <li>A draggable voice chat overlay appears. You can <strong className="text-cc-fg">minimize</strong> it (session stays alive) or <strong className="text-cc-fg">close</strong> it (ends session).</li>
            <li>Speak naturally — Gemini responds with voice in real-time.</li>
            <li>Drag the overlay anywhere on screen. On mobile, it stays accessible while you browse.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">What Gemini can do</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">Run agents</strong> — "Start a coding agent on /my/project"</li>
            <li><strong className="text-cc-fg">Send messages</strong> — "Tell session 3 to run the tests"</li>
            <li><strong className="text-cc-fg">Create agents</strong> — "Create an agent called Monitor that checks server health"</li>
            <li><strong className="text-cc-fg">Make phone calls</strong> — "Call +43 1 234 5678 and ask about the appointment" (requires SIP trunk)</li>
            <li><strong className="text-cc-fg">List sessions</strong> — "What's running right now?"</li>
            <li><strong className="text-cc-fg">Monitor agents</strong> — "What is the coding agent doing?"</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Multimodal input</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">Images</strong> — Click the image icon to upload photos or documents for Gemini to analyze.</li>
            <li><strong className="text-cc-fg">Camera</strong> — Click the camera icon to stream your live camera feed. Gemini receives a frame every 2 seconds.</li>
            <li><strong className="text-cc-fg">Videos</strong> — Upload a video file; HeyHank extracts key frames and sends them to Gemini.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Requirements</h4>
          <p>Requires a <Code>GEMINI_API_KEY</Code> environment variable. Get one free at <strong className="text-cc-fg">aistudio.google.com</strong>.</p>
        </Section>

        {/* ─── Agents ─── */}
        <Section id="agents" title="Agents" icon="&#x1F916;">
          <p>
            Agents are the core of HeyHank. Each agent is a configured AI session with its own name,
            system prompt, LLM model, working directory, and permission mode.
          </p>

          <h4 className="font-semibold text-cc-fg mt-2">Create an agent</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Go to <strong className="text-cc-fg">Agents</strong> in the sidebar.</li>
            <li>Click <strong className="text-cc-fg">+ New Agent</strong>.</li>
            <li>Configure: name, description, system prompt, model, backend, working directory.</li>
            <li>Optionally set triggers: cron schedule (e.g. run every hour) or webhook.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Run an agent</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Click <strong className="text-cc-fg">Run</strong> on an agent card — starts a new session with the agent's prompt.</li>
            <li>Some agents may ask for input before they start (configurable).</li>
            <li>You can also ask Gemini Live: "Run the coding agent" or "Start monitor".</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Agent examples</h4>
          <div className="space-y-1.5 mt-1">
            {[
              { name: "Coding Agent", desc: "Develops features, fixes bugs, writes tests. Works in your project directory with full file and terminal access." },
              { name: "Monitoring Agent", desc: "Checks server health: CPU, RAM, disk, Docker, PM2. Runs on a cron schedule. Read-only mode recommended." },
              { name: "Content Agent", desc: "Creates social media posts, generates images with Imagen, produces videos with Veo." },
              { name: "Personal Agent", desc: "Email management, calendar, reminders. Connects via IMAP/SMTP." },
            ].map((a) => (
              <div key={a.name} className="rounded-lg bg-cc-card p-3 border border-cc-border/50">
                <span className="text-xs font-semibold text-cc-fg">{a.name}</span>
                <span className="text-[11px] text-cc-muted ml-2">{a.desc}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-1">These are just examples — create whatever agents you need for your workflow.</p>
        </Section>

        {/* ─── Sessions & Chat ─── */}
        <Section id="sessions" title="Sessions & Chat" icon="&#x1F4AC;">
          <h4 className="font-semibold text-cc-fg">Create a new session</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Click <strong className="text-cc-fg">+</strong> in the sidebar or <strong className="text-cc-fg">New Session</strong> on the home page.</li>
            <li>Choose a <strong className="text-cc-fg">working directory</strong> — this is where the agent operates.</li>
            <li>Choose a <strong className="text-cc-fg">backend</strong>: Claude (recommended) or Codex.</li>
            <li>Choose the <strong className="text-cc-fg">permission mode</strong>: Accept Edits (default), Plan, Default.</li>
            <li>Optional: Choose a <strong className="text-cc-fg">git branch</strong> as starting point.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-3">In the chat</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">Composer</strong> — Type a message, press <Kbd>Enter</Kbd> to send.</li>
            <li><strong className="text-cc-fg">@-Mentions</strong> — Type <Code>@</Code> to reference files, folders or prompts.</li>
            <li><strong className="text-cc-fg">/Commands</strong> — Type <Code>/</Code> for available commands and skills.</li>
            <li><strong className="text-cc-fg">Images</strong> — Drag & drop or file upload in the composer.</li>
            <li><strong className="text-cc-fg">Permission requests</strong> — When the agent wants to use a tool, a yellow banner appears. Click Allow or Deny.</li>
            <li><strong className="text-cc-fg">Streaming</strong> — Responses are streamed in real time.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-3">Session lifecycle</h4>
          <p>Sessions persist across page reloads and server restarts. Return to any session at any time — the full chat history is preserved.</p>

          <h4 className="font-semibold text-cc-fg mt-3">Session tabs</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">Chat</strong> — The main conversation with the agent.</li>
            <li><strong className="text-cc-fg">Diff</strong> — Git changes the agent has made. Badge = changed file count.</li>
            <li><strong className="text-cc-fg">Terminal</strong> — Shell terminal within the session.</li>
            <li><strong className="text-cc-fg">Processes</strong> — Running processes of the session.</li>
            <li><strong className="text-cc-fg">Editor</strong> — File editor for direct editing.</li>
            <li><strong className="text-cc-fg">Browser</strong> — Embedded browser for web development.</li>
          </ul>
        </Section>

        {/* ─── Media ─── */}
        <Section id="media" title="Media Generation (Image & Video)" icon="&#x1F3A8;">
          <p>Generate images and videos via Google AI APIs directly from agent sessions.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Image Generation (Imagen)</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Models: <Code>imagen-4.0-fast-generate-001</Code> (fast), <Code>imagen-4.0-generate-001</Code> (quality), <Code>imagen-4.0-ultra-generate-001</Code></li>
            <li>Aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4</li>
            <li>Output: PNG file, saved and accessible via URL</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Video Generation (Veo)</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Models: <Code>veo-3.1-fast-generate-preview</Code> (fast), <Code>veo-3.1-generate-preview</Code> (best quality)</li>
            <li>Asynchronous generation — takes 1-3 minutes for a 5-8 second video.</li>
            <li>Output: MP4 file</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">View media</h4>
          <p>All generated media is listed at <Code>/api/media</Code> and can be opened directly in the browser.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Requirements</h4>
          <p>Requires a <Code>GEMINI_API_KEY</Code> with access to Imagen and Veo models.</p>
        </Section>

        {/* ─── Telephony ─── */}
        <Section id="telephony" title="Telephony — AI Phone Calls" icon="&#x1F4DE;">
          <p>
            HeyHank can make and receive phone calls using Gemini Live as the voice engine.
            Calls go through a SIP trunk connected to FreeSWITCH, with Gemini handling the conversation.
          </p>

          <h4 className="font-semibold text-cc-fg mt-2">How it works</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">FreeSWITCH</strong> handles the SIP connection to the phone network.</li>
            <li><strong className="text-cc-fg">Gemini Live</strong> acts as both speech-to-text, LLM, and text-to-speech — no separate STT/TTS services needed.</li>
            <li>Audio is bridged in real-time: FreeSWITCH (8kHz PCM) is resampled to Gemini (16kHz) and back.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Setup</h4>
          <Step n={1}>
            <p>Get a SIP trunk from a provider (e.g. peoplefone, sipgate, easybell).</p>
          </Step>
          <Step n={2}>
            <p>Go to <strong className="text-cc-fg">Settings &rarr; Telephony</strong> and add your SIP trunk credentials.</p>
          </Step>
          <Step n={3}>
            <p>Start the FreeSWITCH Docker container (included in the HeyHank package).</p>
          </Step>
          <Step n={4}>
            <p>Test the connection in Settings, then make calls via the Telephony page or Gemini voice command.</p>
          </Step>

          <h4 className="font-semibold text-cc-fg mt-2">Making calls</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">Telephony page</strong> — Dial a number, describe the task, and start the call.</li>
            <li><strong className="text-cc-fg">Gemini voice</strong> — "Call +43 1 234 5678 and ask about the delivery"</li>
            <li>Live transcript is displayed in real-time during the call.</li>
            <li>Call history with summaries is saved automatically.</li>
          </ul>
        </Section>

        {/* ─── Federation ─── */}
        <Section id="federation" title="Federation — Multi-Node" icon="&#x1F310;">
          <p>
            Connect multiple HeyHank instances together in a peer-to-peer mesh.
            Run HeyHank on your laptop, VPS, or both — all nodes see each other's sessions and agents.
          </p>

          <h4 className="font-semibold text-cc-fg mt-2">How it works</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Each HeyHank instance is a <strong className="text-cc-fg">node</strong> with a unique ID.</li>
            <li>Nodes connect to each other via WebSocket with shared-secret authentication.</li>
            <li>Sessions and agents are synced automatically — remote sessions appear in your sidebar with a node badge.</li>
            <li>Gemini on any node can see and control sessions across all connected nodes.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Setup</h4>
          <Step n={1}>
            <p>Go to <strong className="text-cc-fg">Settings &rarr; Federation</strong> on both nodes.</p>
          </Step>
          <Step n={2}>
            <p>Copy the connection URL from Node B.</p>
          </Step>
          <Step n={3}>
            <p>On Node A, click <strong className="text-cc-fg">Add Node</strong> and paste the URL + shared secret.</p>
          </Step>
          <Step n={4}>
            <p>Both nodes now see each other's sessions. Gemini can control agents across both.</p>
          </Step>

          <h4 className="font-semibold text-cc-fg mt-2">Offline handling</h4>
          <p>If a node goes offline, its sessions are marked as disconnected and disappear after 60 seconds. When the node comes back, auto-reconnect restores everything.</p>
        </Section>

        {/* ─── Sidebar ─── */}
        <Section id="sidebar" title="Sidebar — Navigation" icon="&#x1F4CB;">
          <p>The sidebar is your main navigation. On mobile, open it with the hamburger icon. On desktop, it's always visible.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Upper area: Sessions</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">+ Button</strong> — Start a new chat session.</li>
            <li><strong className="text-cc-fg">Session list</strong> — All active sessions, grouped by project. Click to open.</li>
            <li><strong className="text-cc-fg">Right-click / 3-dots</strong> — Rename, Archive, Delete.</li>
            <li><strong className="text-cc-fg">Archived sessions</strong> — Collapsible at the bottom, can be restored.</li>
            <li>Status dots: green = connected, yellow = reconnecting, red = disconnected.</li>
            <li>Badge = open permission requests awaiting confirmation.</li>
            <li>Node badge = session is from a remote federated node.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-3">Lower area: Pages</h4>
          <div className="space-y-1">
            <p><strong className="text-cc-fg">Workbench:</strong> Prompts, Integrations, Terminal</p>
            <p><strong className="text-cc-fg">Workspace:</strong> Environments, Agents, Telephony, Platform, Settings, Help</p>
          </div>
        </Section>

        {/* ─── Platform Dashboard ─── */}
        <Section id="platform" title="Platform Dashboard" icon="&#x1F4CA;">
          <p>The Platform page shows the overall state of your agent system.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Kill Switch</h4>
          <p>Emergency stop for all agents. Red KILL button stops everything immediately.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Cost Tracking</h4>
          <p>Total costs, token usage (in/out), and per-session cost breakdown with model info.</p>

          <h4 className="font-semibold text-cc-fg mt-2">LLM Providers</h4>
          <p>Status of all LLM backends: Claude, Gemini, Ollama, Codex. Green = available, yellow = needs API key.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Agent Messages</h4>
          <p>Last 20 inter-agent messages — see how agents communicate with each other.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Shared Context</h4>
          <p>Shared knowledge files accessible by all agents. Click to read, edit to modify.</p>
        </Section>

        {/* ─── PWA ─── */}
        <Section id="pwa" title="PWA & Mobile" icon="&#x1F4F1;">
          <h4 className="font-semibold text-cc-fg">Install as app</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">iPhone/iPad:</strong> Safari &rarr; Share &rarr; "Add to Home Screen"</li>
            <li><strong className="text-cc-fg">Android:</strong> Chrome &rarr; Menu &rarr; "Install app"</li>
            <li><strong className="text-cc-fg">Desktop:</strong> Chrome/Edge &rarr; Address bar &rarr; Install icon</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Push Notifications</h4>
          <p>HeyHank can send push notifications for agent alerts and monitoring warnings. Enable on first visit when the browser asks for permission.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Mobile tips</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>The Gemini Live voice overlay is draggable and collapsible — works well on small screens.</li>
            <li>Use the camera icon in voice chat to stream your phone camera to Gemini.</li>
            <li>The PWA caches static assets for fast loading. Agent interaction requires a connection.</li>
          </ul>
        </Section>

        {/* ─── Keyboard ─── */}
        <Section id="keyboard" title="Keyboard Shortcuts" icon="&#x2328;">
          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <Kbd>Enter</Kbd><span>Send message</span>
            <Kbd>Shift+Enter</Kbd><span>New line in composer</span>
            <Kbd>Escape</Kbd><span>Deny permission request / Interrupt</span>
            <Kbd>@</Kbd><span>Reference file/folder/prompt</span>
            <Kbd>/</Kbd><span>Commands and skills</span>
            <Kbd>Ctrl+`</Kbd><span>Open/close quick terminal</span>
          </div>
        </Section>

        {/* ─── Tailscale ─── */}
        <Section id="tailscale" title="Tailscale Setup" icon="&#x1F310;">
          <p>Tailscale Funnel gives HeyHank a public HTTPS URL without port forwarding, firewall changes, or a reverse proxy. It works by routing traffic through Tailscale's network to your machine.</p>

          <h4 className="font-semibold text-cc-fg mt-3">1. Install Tailscale</h4>
          <p>Download from <a href="https://tailscale.com/download" target="_blank" rel="noopener" className="text-cc-accent hover:underline">tailscale.com/download</a> or install via CLI:</p>
          <div className="font-mono text-xs bg-cc-bg rounded p-2 mt-1">curl -fsSL https://tailscale.com/install.sh | sh</div>

          <h4 className="font-semibold text-cc-fg mt-3">2. Connect to your Tailnet</h4>
          <div className="font-mono text-xs bg-cc-bg rounded p-2 mt-1">tailscale up</div>
          <p className="mt-1">Follow the login URL to authenticate. Your machine will get a DNS name like <Code>machine.tail1234.ts.net</Code>.</p>

          <h4 className="font-semibold text-cc-fg mt-3">3. Enable Funnel</h4>
          <p>HeyHank manages Funnel automatically. Go to <strong>Settings</strong> and click <strong>Enable Tailscale Funnel</strong>. This exposes HeyHank over HTTPS at your Tailscale DNS name.</p>
          <p className="mt-1">You can also enable it manually:</p>
          <div className="font-mono text-xs bg-cc-bg rounded p-2 mt-1">tailscale funnel --bg {"{port}"}</div>

          <h4 className="font-semibold text-cc-fg mt-3">4. Linux: Operator Mode</h4>
          <p>If running HeyHank as a non-root user on Linux, you need to set operator mode so HeyHank can manage Funnel without sudo:</p>
          <div className="font-mono text-xs bg-cc-bg rounded p-2 mt-1">sudo tailscale set --operator=$USER</div>

          <h4 className="font-semibold text-cc-fg mt-3">Troubleshooting</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>DNS not propagated:</strong> After enabling Funnel, DNS may take a few minutes to propagate. HeyHank will show a warning until resolution succeeds.</li>
            <li><strong>Operator mode needed:</strong> On Linux, if you see permission errors, run <Code>sudo tailscale set --operator=$USER</Code> and restart HeyHank.</li>
            <li><strong>Binary not found:</strong> Ensure <Code>tailscale</Code> is on your PATH. HeyHank checks for it automatically on startup.</li>
            <li><strong>Funnel not working:</strong> Make sure Funnel is enabled in your Tailscale admin console under the DNS tab (Access Controls).</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-4">Remote Ollama via Tailscale</h4>
          <p>If you run HeyHank on a VPS but Ollama on a local GPU machine, Tailscale provides a secure private connection without port forwarding or HTTPS certificates.</p>

          <h4 className="font-semibold text-cc-fg mt-3">Setup</h4>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Install Tailscale on <strong className="text-cc-fg">both</strong> machines (VPS + GPU machine)</li>
            <li>Join the same Tailnet: <Code>tailscale up</Code> on each</li>
            <li>On the GPU machine, ensure Ollama listens on all interfaces:
              <div className="font-mono text-xs bg-cc-bg rounded p-2 mt-1">OLLAMA_HOST=0.0.0.0 ollama serve</div>
            </li>
            <li>In HeyHank Settings → Providers, set the Ollama URL to your Tailscale hostname:
              <div className="font-mono text-xs bg-cc-bg rounded p-2 mt-1">http://gpu-machine.tail1234.ts.net:11434</div>
            </li>
          </ol>

          <h4 className="font-semibold text-cc-fg mt-3">Why Tailscale?</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">Encrypted:</strong> WireGuard encryption between all nodes — no need for HTTPS</li>
            <li><strong className="text-cc-fg">No port forwarding:</strong> Works behind NAT and firewalls</li>
            <li><strong className="text-cc-fg">Private:</strong> Only your devices can reach the Ollama API</li>
          </ul>
        </Section>

        {/* ─── API ─── */}
        <Section id="api" title="API Reference" icon="&#x1F527;">
          <p>All endpoints are available under <Code>/api/</Code>. Authentication via bearer token.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Sessions</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>GET /api/sessions — List all sessions</p>
            <p>POST /api/sessions — Create new session</p>
            <p>DELETE /api/sessions/:id — Delete session</p>
          </div>

          <h4 className="font-semibold text-cc-fg mt-2">Agents</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>GET /api/agents — List all agents</p>
            <p>POST /api/agents — Create agent</p>
            <p>PUT /api/agents/:id — Update agent</p>
            <p>DELETE /api/agents/:id — Delete agent</p>
            <p>POST /api/agents/:id/run — Run agent</p>
          </div>

          <h4 className="font-semibold text-cc-fg mt-2">Media</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>POST /api/media/generate-image — Generate image</p>
            <p>POST /api/media/generate-video — Generate video</p>
            <p>GET /api/media — List all media</p>
            <p>GET /api/media/file/:filename — Get media file</p>
          </div>

          <h4 className="font-semibold text-cc-fg mt-2">Telephony</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>POST /api/telephony/calls — Start a call</p>
            <p>GET /api/telephony/calls — Active calls</p>
            <p>DELETE /api/telephony/calls/:id — End call</p>
            <p>GET /api/telephony/history — Call history</p>
            <p>GET/PUT /api/telephony/settings — Telephony settings</p>
          </div>

          <h4 className="font-semibold text-cc-fg mt-2">Federation</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>GET /api/federation/identity — This node's identity</p>
            <p>GET /api/federation/nodes — Connected nodes</p>
            <p>POST /api/federation/nodes — Add node</p>
            <p>DELETE /api/federation/nodes/:id — Remove node</p>
            <p>GET /api/federation/remote-sessions — Sessions from other nodes</p>
          </div>

          <h4 className="font-semibold text-cc-fg mt-2">Platform</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>GET /api/costs/summary — Cost summary</p>
            <p>GET/POST /api/kill-switch — Kill switch</p>
            <p>GET /api/llm/providers — LLM provider status</p>
            <p>GET /api/shared-context — Shared context files</p>
            <p>POST /api/llm/chat — Direct LLM call</p>
          </div>

          <h4 className="font-semibold text-cc-fg mt-2">Gemini</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>GET /gemini/config — Voice assistant config + active sessions</p>
            <p>POST /gemini/tool-call — Execute a Gemini tool call</p>
          </div>
        </Section>

        {/* Footer */}
        <div className="text-center text-xs text-cc-muted pt-4 pb-8 space-y-1">
          <p>HeyHank — Self-hosted AI Agent Platform</p>
          <p>
            Bugs or feature requests?{" "}
            <a href="https://github.com/heyhank-app/heyhank/issues" target="_blank" rel="noopener noreferrer" className="text-cc-primary hover:underline">
              Open an issue on GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
