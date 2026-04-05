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

// ─── Quick Nav ──────────────────────────────────────────────────────────────

function QuickNav() {
  const sections = [
    { id: "overview", label: "Overview" },
    { id: "first-steps", label: "Getting Started" },
    { id: "sidebar", label: "Sidebar" },
    { id: "sessions", label: "Sessions & Chat" },
    { id: "agents", label: "Agents" },
    { id: "platform", label: "Platform Dashboard" },
    { id: "media", label: "Media (Image & Video)" },
    { id: "tabs", label: "Tabs & Views" },
    { id: "pwa", label: "PWA & Mobile" },
    { id: "keyboard", label: "Keyboard Shortcuts" },
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
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-6 pb-24">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-cc-fg">HeyHank Help</h1>
          <p className="text-sm text-cc-muted mt-1">
            HeyHank Platform with 6 specialized agents
          </p>
        </div>

        <QuickNav />

        {/* ─── Overview ─── */}
        <Section id="overview" title="Overview" icon="&#x1F3E0;" defaultOpen>
          <p>
            The Agent Platform is your personal multi-agent system. 6 specialized AI agents
            work for you — individually or together. Each agent has its own capabilities,
            system instructions and access to various tools.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
            {[
              { name: "Coding Agent", desc: "Frontend, Backend, Security", color: "text-blue-400" },
              { name: "Monitoring", desc: "Server, Health Checks", color: "text-green-400" },
              { name: "Marketing", desc: "SEO, Ads, Analytics", color: "text-purple-400" },
              { name: "Content", desc: "Social Media, Image, Video", color: "text-pink-400" },
              { name: "Personal", desc: "Email, Calendar", color: "text-yellow-400" },
              { name: "Agent Max 2.0", desc: "Autonomous Meta-Agent", color: "text-orange-400" },
            ].map((a) => (
              <div key={a.name} className="rounded-lg bg-cc-card p-3 border border-cc-border/50">
                <div className={`text-xs font-semibold ${a.color}`}>{a.name}</div>
                <div className="text-[11px] text-cc-muted mt-0.5">{a.desc}</div>
              </div>
            ))}
          </div>
          <p className="mt-2">
            <strong className="text-cc-fg">LLM Backends:</strong> Claude CLI (Max subscription), Ollama (local, free),
            Gemini API, Codex CLI — automatically selected per agent.
          </p>
        </Section>

        {/* ─── Getting Started ─── */}
        <Section id="first-steps" title="Getting Started" icon="&#x1F680;">
          <Step n={1}>
            <p><strong className="text-cc-fg">Log in</strong> — Open the platform URL and enter the auth token.</p>
          </Step>
          <Step n={2}>
            <p><strong className="text-cc-fg">Start a session</strong> — Click <strong className="text-cc-fg">+ New Session</strong> at the top of the sidebar or on the home page. Choose a working directory and backend (Claude/Codex).</p>
          </Step>
          <Step n={3}>
            <p><strong className="text-cc-fg">Chat</strong> — Type your message in the composer at the bottom and press <Kbd>Enter</Kbd>. The agent responds with text, executes tools (read/write files, Bash, etc.) and asks for permission when needed.</p>
          </Step>
          <Step n={4}>
            <p><strong className="text-cc-fg">Choose an agent</strong> — Go to <strong className="text-cc-fg">Agents</strong> in the sidebar, click <strong className="text-cc-fg">Run</strong> on an agent. The agent starts with its predefined system prompt.</p>
          </Step>
        </Section>

        {/* ─── Sidebar ─── */}
        <Section id="sidebar" title="Sidebar — Navigation" icon="&#x1F4CB;">
          <p>The sidebar on the left is your main navigation point. Open it with the hamburger icon (mobile) or it is always visible (desktop).</p>

          <h4 className="font-semibold text-cc-fg mt-2">Upper Area: Sessions</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">+ Button</strong> (top right) — Starts a new chat session. You choose the working directory and backend (Claude or Codex).</li>
            <li><strong className="text-cc-fg">Session list</strong> — All active sessions, grouped by project/git repo. Click to open.</li>
            <li><strong className="text-cc-fg">Right-click/3-dots</strong> on a session — Rename, Archive, Delete.</li>
            <li><strong className="text-cc-fg">Archived sessions</strong> — Collapsible at the bottom, can be restored or deleted.</li>
            <li>Colored dots indicate status: green = connected, yellow = reconnecting, red = disconnected.</li>
            <li>Badge number = open permission requests awaiting confirmation.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-3">Lower Area: Navigation</h4>
          <div className="space-y-1">
            <p><strong className="text-cc-fg">Workbench:</strong></p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><strong>Prompts</strong> — Manage saved prompt templates and use them in sessions.</li>
              <li><strong>Integrations</strong> — Connect Linear, Tailscale and other services.</li>
              <li><strong>Terminal</strong> — Standalone terminal with full shell access.</li>
            </ul>
            <p className="mt-2"><strong className="text-cc-fg">Workspace:</strong></p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><strong>Environments</strong> — Environment variable profiles (e.g. API keys per project).</li>
              <li><strong>Sandboxes</strong> — Isolated container environments.</li>
              <li><strong>Agents</strong> — Manage and run the 6 preconfigured agents.</li>
              <li><strong>Platform</strong> — Dashboard with kill switch, costs, messages, providers.</li>
              <li><strong>Settings</strong> — App settings, dark mode, auth.</li>
              <li><strong>Help</strong> — This page.</li>
            </ul>
          </div>
        </Section>

        {/* ─── Sessions & Chat ─── */}
        <Section id="sessions" title="Sessions & Chat" icon="&#x1F4AC;">
          <h4 className="font-semibold text-cc-fg">Create a new session</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Click <strong className="text-cc-fg">+</strong> in the sidebar or <strong className="text-cc-fg">New Session</strong> on the home page.</li>
            <li>Choose a <strong className="text-cc-fg">working directory</strong> (cwd) — this is where the agent operates.</li>
            <li>Choose a <strong className="text-cc-fg">backend</strong>: Claude (recommended) or Codex.</li>
            <li>Choose the <strong className="text-cc-fg">permission mode</strong>: Accept Edits (default), Plan, Default.</li>
            <li>Optional: Choose a <strong className="text-cc-fg">git branch</strong> as starting point.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-3">In the chat</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">Composer</strong> (input field at the bottom) — Type a message, press <Kbd>Enter</Kbd> to send.</li>
            <li><strong className="text-cc-fg">@-Mentions</strong> — Type <code className="text-xs bg-cc-card px-1 rounded">@</code> to reference files, folders or prompts.</li>
            <li><strong className="text-cc-fg">/Commands</strong> — Type <code className="text-xs bg-cc-card px-1 rounded">/</code> for available commands and skills.</li>
            <li><strong className="text-cc-fg">Images</strong> — Drag & drop or file upload in the composer.</li>
            <li><strong className="text-cc-fg">Permission requests</strong> — When the agent wants to use a tool (e.g. write a file), a yellow banner appears. Click <strong className="text-cc-fg">Allow</strong> or <strong className="text-cc-fg">Deny</strong>.</li>
            <li><strong className="text-cc-fg">Streaming</strong> — Responses are streamed in real time. You see the text as it is being generated.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-3">Session lifecycle</h4>
          <p>Sessions persist even when you close the page or the server restarts. You can return to an old session at any time — the full chat history is there.</p>
        </Section>

        {/* ─── Agents ─── */}
        <Section id="agents" title="Agents" icon="&#x1F916;">
          <p>Go to <strong className="text-cc-fg">Agents</strong> in the sidebar. You will see all 6 preconfigured agents as cards.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Start an agent</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Click <strong className="text-cc-fg">Run</strong> on an agent card — starts a new session with the agent prompt.</li>
            <li>Some agents ask for input (e.g. &quot;What should I code?&quot;) before they start.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Edit an agent</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Click <strong className="text-cc-fg">Edit</strong> on an agent card — opens the editor.</li>
            <li>You can change: name, description, system prompt, model, backend, cwd, triggers (cron, webhook).</li>
            <li><strong className="text-cc-fg">+ New Agent</strong> — Creates a completely new agent.</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">The 6 agents in detail</h4>
          <div className="space-y-2 mt-1">
            <AgentDetail
              name="Coding Agent"
              model="Claude Sonnet 4.6"
              desc="Develops frontend, backend and security. Can read/write files, execute Bash, use Git. Works in project directories."
            />
            <AgentDetail
              name="Monitoring Agent"
              model="Claude Haiku (budget)"
              desc="Checks server health: PM2, Docker, Nginx, disk, RAM, CPU. Can run automatically via cron schedule (currently disabled to save credits). Read-only access."
            />
            <AgentDetail
              name="Marketing Agent"
              model="Claude Sonnet 4.6"
              desc="SEO analysis, paid ads strategy, analytics. Has web research capabilities. Sub-agents: SEO, GEO/AI-SEO, Ads, Creative, Analytics, Persona."
            />
            <AgentDetail
              name="Content Agent"
              model="Claude Sonnet 4.6"
              desc="Creates social media posts, generates images (Imagen 4.0) and videos (Veo 3.1). Sub-agents: Social Media, Image Generation, Video Generation."
            />
            <AgentDetail
              name="Personal Agent"
              model="Claude Haiku"
              desc="Email management, calendar, reminders. IMAP/SMTP will be configured later. Push notifications for reminders."
            />
            <AgentDetail
              name="Agent Max 2.0"
              model="Claude Opus 4.6"
              desc="The autonomous meta-agent. Thinks like you, delegates to other agents via MessageBus. Can independently decide which agent is needed. Has access to the entire shared context. Auto-approve: autonomously confirms tool requests from other agents."
            />
          </div>
        </Section>

        {/* ─── Platform Dashboard ─── */}
        <Section id="platform" title="Platform Dashboard" icon="&#x1F4CA;">
          <p>Go to <strong className="text-cc-fg">Platform</strong> in the sidebar. Here you see the overall state of your agent system.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Kill Switch</h4>
          <p>Emergency stop for all agents. Red <strong className="text-cc-fg">KILL</strong> button stops everything immediately. Green = agents running normally. Optionally enter a reason.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Cost Tracking</h4>
          <p>Shows total costs, token usage (in/out) and a table per agent with model and costs. Refresh button for current data.</p>

          <h4 className="font-semibold text-cc-fg mt-2">LLM Providers</h4>
          <p>Status of all available LLM backends:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><strong className="text-green-400">Green</strong> = available/configured (Ollama, Gemini, Claude, Codex)</li>
            <li><strong className="text-yellow-400">Yellow</strong> = needs API key (OpenRouter — optional)</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Agent Messages</h4>
          <p>The last 20 inter-agent messages. Shows who wrote to whom, type (task, result, interrupt, info) and content. This is how you see how agents communicate with each other.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Shared Context</h4>
          <p>Shared knowledge that all agents can access. Click on a file to read, <strong className="text-cc-fg">Edit</strong> to modify. Default files: <code className="text-xs bg-cc-card px-1 rounded">platform-info.md</code>, <code className="text-xs bg-cc-card px-1 rounded">active-projects.md</code>.</p>
        </Section>

        {/* ─── Media ─── */}
        <Section id="media" title="Media Generation (Image & Video)" icon="&#x1F3A8;">
          <p>The platform can generate images and videos via Google AI APIs.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Image Generation (Imagen 4.0)</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Default model: <code className="text-xs bg-cc-card px-1 rounded">imagen-4.0-fast-generate-001</code></li>
            <li>Also available: <code className="text-xs bg-cc-card px-1 rounded">imagen-4.0-generate-001</code> (quality), <code className="text-xs bg-cc-card px-1 rounded">imagen-4.0-ultra-generate-001</code></li>
            <li>Aspect ratio selectable: 1:1, 16:9, 9:16, 4:3, 3:4</li>
            <li>Output: PNG file, saved and accessible via URL</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Video Generation (Veo 3.1)</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Default model: <code className="text-xs bg-cc-card px-1 rounded">veo-3.1-fast-generate-preview</code> (fast)</li>
            <li>Also available: <code className="text-xs bg-cc-card px-1 rounded">veo-3.1-generate-preview</code> (best quality)</li>
            <li>Video generation is asynchronous — you get an operation ID and poll the status.</li>
            <li>Duration: 5-8 second video, takes approx. 1-3 minutes to generate.</li>
            <li>Output: MP4 file</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">View media</h4>
          <p>All generated media can be found at <code className="text-xs bg-cc-card px-1 rounded">/api/media</code> (list) and opened directly in the browser: <code className="text-xs bg-cc-card px-1 rounded">/api/media/file/FILENAME</code></p>
        </Section>

        {/* ─── Tabs ─── */}
        <Section id="tabs" title="Tabs & Views" icon="&#x1F5C2;">
          <p>In an active session you see various tabs in the top bar:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">Chat</strong> — The main chat with the agent. Most interaction happens here.</li>
            <li><strong className="text-cc-fg">Diff</strong> — Shows git changes the agent has made. Badge number = number of changed files.</li>
            <li><strong className="text-cc-fg">Terminal</strong> — Shell terminal within the session. Usable alongside the chat.</li>
            <li><strong className="text-cc-fg">Processes</strong> — Running processes of the session.</li>
            <li><strong className="text-cc-fg">Editor</strong> — File editor for direct editing.</li>
            <li><strong className="text-cc-fg">Browser</strong> — Embedded browser (for web development).</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Context Panel (right)</h4>
          <p>On desktop screens there is a collapsible context panel on the right. It shows tasks and context information for the current session. Open it with the small tab on the right edge or in the top bar.</p>
        </Section>

        {/* ─── PWA ─── */}
        <Section id="pwa" title="PWA & Mobile" icon="&#x1F4F1;">
          <h4 className="font-semibold text-cc-fg">Install app</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-cc-fg">iPhone/iPad:</strong> Open Safari → Share button → &quot;Add to Home Screen&quot;</li>
            <li><strong className="text-cc-fg">Android:</strong> Open Chrome → 3-dot menu → &quot;Install app&quot; / &quot;Add to home screen&quot;</li>
            <li><strong className="text-cc-fg">Desktop:</strong> Chrome/Edge → Address bar → Install icon</li>
          </ul>

          <h4 className="font-semibold text-cc-fg mt-2">Push Notifications</h4>
          <p>The app can send push notifications (agent alerts, monitoring warnings, reminders). On first visit the browser asks for permission. Test notification available via the Platform Dashboard.</p>

          <h4 className="font-semibold text-cc-fg mt-2">Offline</h4>
          <p>The PWA caches static assets (CSS, JS, fonts, images). The UI loads offline too — but for agent interaction you naturally need a connection.</p>
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

        {/* ─── API ─── */}
        <Section id="api" title="API Reference (for developers)" icon="&#x1F527;">
          <p>All API endpoints are available under <code className="text-xs bg-cc-card px-1 rounded">/api/</code>:</p>

          <h4 className="font-semibold text-cc-fg mt-2">Sessions</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>GET /api/sessions — List all sessions</p>
            <p>POST /api/sessions — Create new session</p>
            <p>DELETE /api/sessions/:id — Delete session</p>
          </div>

          <h4 className="font-semibold text-cc-fg mt-2">Platform</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>GET /api/messages — Inter-agent messages</p>
            <p>GET /api/costs/summary — Cost summary</p>
            <p>GET /api/kill-switch — Kill switch status</p>
            <p>POST /api/kill-switch/activate — Activate kill switch</p>
            <p>GET /api/shared-context — Shared context files</p>
            <p>GET /api/llm/providers — LLM provider status</p>
            <p>GET /api/agent-timeouts — Timeout configuration</p>
          </div>

          <h4 className="font-semibold text-cc-fg mt-2">Media</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>POST /api/media/generate-image — Generate image</p>
            <p>POST /api/media/generate-video — Generate video</p>
            <p>GET /api/media/video-status/:op — Check video status</p>
            <p>GET /api/media — List all generated media</p>
            <p>GET /api/media/file/:filename — Retrieve media file</p>
          </div>

          <h4 className="font-semibold text-cc-fg mt-2">LLM Direct</h4>
          <div className="font-mono text-xs space-y-0.5">
            <p>POST /api/llm/chat — Call LLM directly (Ollama/Gemini)</p>
            <p>POST /api/llm/stream — SSE streaming (Ollama)</p>
            <p>GET /api/llm/ollama/models — List Ollama models</p>
          </div>
        </Section>

        {/* Footer */}
        <div className="text-center text-xs text-cc-muted pt-4 pb-8 space-y-1">
          <p>HeyHank v1.0</p>
          <p>Bugs or feedback? Chat with the Coding Agent or open an issue.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function AgentDetail({ name, model, desc }: { name: string; model: string; desc: string }) {
  return (
    <div className="rounded-lg bg-cc-card p-3 border border-cc-border/50">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-cc-fg">{name}</span>
        <span className="text-[10px] text-cc-muted bg-cc-hover px-2 py-0.5 rounded">{model}</span>
      </div>
      <p className="text-[11px] text-cc-muted mt-1">{desc}</p>
    </div>
  );
}
