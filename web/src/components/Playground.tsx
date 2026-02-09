import { useState, useEffect } from "react";
import { PermissionBanner } from "./PermissionBanner.js";
import { MessageBubble } from "./MessageBubble.js";
import { ToolBlock } from "./ToolBlock.js";
import type { PermissionRequest, ChatMessage, ContentBlock } from "../types.js";
import type { TaskItem } from "../types.js";

// ─── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_SESSION_ID = "playground-session";

function mockPermission(overrides: Partial<PermissionRequest> & { tool_name: string; input: Record<string, unknown> }): PermissionRequest {
  return {
    request_id: `perm-${Math.random().toString(36).slice(2, 8)}`,
    tool_use_id: `tu-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...overrides,
  };
}

const PERM_BASH = mockPermission({
  tool_name: "Bash",
  input: {
    command: "git log --oneline -20 && npm run build",
    description: "View recent commits and build the project",
  },
});

const PERM_EDIT = mockPermission({
  tool_name: "Edit",
  input: {
    file_path: "/Users/stan/Dev/project/src/utils/format.ts",
    old_string: 'export function formatDate(d: Date) {\n  return d.toISOString();\n}',
    new_string: 'export function formatDate(d: Date, locale = "en-US") {\n  return d.toLocaleDateString(locale, {\n    year: "numeric",\n    month: "short",\n    day: "numeric",\n  });\n}',
  },
});

const PERM_WRITE = mockPermission({
  tool_name: "Write",
  input: {
    file_path: "/Users/stan/Dev/project/src/config.ts",
    content: 'export const config = {\n  apiUrl: "https://api.example.com",\n  timeout: 5000,\n  retries: 3,\n  debug: process.env.NODE_ENV !== "production",\n};\n',
  },
});

const PERM_READ = mockPermission({
  tool_name: "Read",
  input: { file_path: "/Users/stan/Dev/project/package.json" },
});

const PERM_GLOB = mockPermission({
  tool_name: "Glob",
  input: { pattern: "**/*.test.ts", path: "/Users/stan/Dev/project/src" },
});

const PERM_GREP = mockPermission({
  tool_name: "Grep",
  input: { pattern: "TODO|FIXME|HACK", path: "/Users/stan/Dev/project/src", glob: "*.ts" },
});

const PERM_EXIT_PLAN = mockPermission({
  tool_name: "ExitPlanMode",
  input: {
    plan: `## Summary\nRefactor the authentication module to use JWT tokens instead of session cookies.\n\n## Changes\n1. **Add JWT utility** — new \`src/auth/jwt.ts\` with sign/verify helpers\n2. **Update middleware** — modify \`src/middleware/auth.ts\` to validate Bearer tokens\n3. **Migrate login endpoint** — return JWT in response body instead of Set-Cookie\n4. **Update tests** — adapt all auth tests to use token-based flow\n\n## Test plan\n- Run \`npm test -- --grep auth\`\n- Manual test with curl`,
    allowedPrompts: [
      { tool: "Bash", prompt: "run tests" },
      { tool: "Bash", prompt: "install dependencies" },
    ],
  },
});

const PERM_GENERIC = mockPermission({
  tool_name: "WebSearch",
  input: { query: "TypeScript 5.5 new features", allowed_domains: ["typescriptlang.org", "github.com"] },
  description: "Search the web for TypeScript 5.5 features",
});

const PERM_ASK_SINGLE = mockPermission({
  tool_name: "AskUserQuestion",
  input: {
    questions: [
      {
        header: "Auth method",
        question: "Which authentication method should we use for the API?",
        options: [
          { label: "JWT tokens (Recommended)", description: "Stateless, scalable, works well with microservices" },
          { label: "Session cookies", description: "Traditional approach, simpler but requires session storage" },
          { label: "OAuth 2.0", description: "Delegated auth, best for third-party integrations" },
        ],
        multiSelect: false,
      },
    ],
  },
});

const PERM_ASK_MULTI = mockPermission({
  tool_name: "AskUserQuestion",
  input: {
    questions: [
      {
        header: "Database",
        question: "Which database should we use?",
        options: [
          { label: "PostgreSQL", description: "Relational, strong consistency" },
          { label: "MongoDB", description: "Document store, flexible schema" },
        ],
        multiSelect: false,
      },
      {
        header: "Cache",
        question: "Do you want to add a caching layer?",
        options: [
          { label: "Redis", description: "In-memory, fast, supports pub/sub" },
          { label: "No cache", description: "Keep it simple for now" },
        ],
        multiSelect: false,
      },
    ],
  },
});

// Messages
const MSG_USER: ChatMessage = {
  id: "msg-1",
  role: "user",
  content: "Can you help me refactor the authentication module to use JWT tokens?",
  timestamp: Date.now() - 60000,
};

const MSG_USER_IMAGE: ChatMessage = {
  id: "msg-2",
  role: "user",
  content: "Here's a screenshot of the error I'm seeing",
  images: [
    {
      media_type: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==",
    },
  ],
  timestamp: Date.now() - 55000,
};

const MSG_ASSISTANT: ChatMessage = {
  id: "msg-3",
  role: "assistant",
  content: "",
  contentBlocks: [
    {
      type: "text",
      text: "I'll help you refactor the authentication module. Let me first look at the current implementation.\n\nHere's what I found:\n- The current auth uses **session cookies** via `express-session`\n- Sessions are stored in a `MemoryStore` (not production-ready)\n- The middleware checks `req.session.userId`\n\n```typescript\n// Current implementation\napp.use(session({\n  secret: process.env.SESSION_SECRET,\n  resave: false,\n  saveUninitialized: false,\n}));\n```\n\n| Feature | Cookies | JWT |\n|---------|---------|-----|\n| Stateless | No | Yes |\n| Scalable | Limited | Excellent |\n| Revocation | Easy | Needs blocklist |\n",
    },
  ],
  timestamp: Date.now() - 50000,
};

const MSG_ASSISTANT_TOOLS: ChatMessage = {
  id: "msg-4",
  role: "assistant",
  content: "",
  contentBlocks: [
    { type: "text", text: "Let me check the current auth files." },
    {
      type: "tool_use",
      id: "tu-1",
      name: "Glob",
      input: { pattern: "src/auth/**/*.ts" },
    },
    {
      type: "tool_result",
      tool_use_id: "tu-1",
      content: "src/auth/middleware.ts\nsrc/auth/login.ts\nsrc/auth/session.ts",
    },
    {
      type: "tool_use",
      id: "tu-2",
      name: "Read",
      input: { file_path: "src/auth/middleware.ts" },
    },
    {
      type: "tool_result",
      tool_use_id: "tu-2",
      content: 'export function authMiddleware(req, res, next) {\n  if (!req.session.userId) {\n    return res.status(401).json({ error: "Unauthorized" });\n  }\n  next();\n}',
    },
    { type: "text", text: "Now I understand the current structure. Let me create the JWT utility." },
  ],
  timestamp: Date.now() - 45000,
};

const MSG_ASSISTANT_THINKING: ChatMessage = {
  id: "msg-5",
  role: "assistant",
  content: "",
  contentBlocks: [
    {
      type: "thinking",
      thinking: "Let me think about the best approach here. The user wants to migrate from session cookies to JWT. I need to:\n1. Create a JWT sign/verify utility\n2. Update the middleware to read Authorization header\n3. Change the login endpoint to return a token\n4. Update all tests\n\nI should use jsonwebtoken package for signing and jose for verification in edge environments. But since this is a Node.js server, jsonwebtoken is fine.\n\nThe token should contain: userId, role, iat, exp. Expiry should be configurable. I'll also add a refresh token mechanism.",
    },
    { type: "text", text: "I've analyzed the codebase and have a clear plan. Let me start implementing." },
  ],
  timestamp: Date.now() - 40000,
};

const MSG_SYSTEM: ChatMessage = {
  id: "msg-6",
  role: "system",
  content: "Context compacted successfully",
  timestamp: Date.now() - 30000,
};

// Tool result with error
const MSG_TOOL_ERROR: ChatMessage = {
  id: "msg-7",
  role: "assistant",
  content: "",
  contentBlocks: [
    { type: "text", text: "Let me try running the tests." },
    {
      type: "tool_use",
      id: "tu-3",
      name: "Bash",
      input: { command: "npm test -- --grep auth" },
    },
    {
      type: "tool_result",
      tool_use_id: "tu-3",
      content: "FAIL src/auth/__tests__/middleware.test.ts\n  ● Auth Middleware › should reject expired tokens\n    Expected: 401\n    Received: 500\n\n    TypeError: Cannot read property 'verify' of undefined",
      is_error: true,
    },
    { type: "text", text: "There's a test failure. Let me fix the issue." },
  ],
  timestamp: Date.now() - 20000,
};

// Tasks
const MOCK_TASKS: TaskItem[] = [
  { id: "1", subject: "Create JWT utility module", description: "", status: "completed" },
  { id: "2", subject: "Update auth middleware", description: "", status: "completed", activeForm: "Updating auth middleware" },
  { id: "3", subject: "Migrate login endpoint", description: "", status: "in_progress", activeForm: "Refactoring login to return JWT" },
  { id: "4", subject: "Add refresh token support", description: "", status: "pending" },
  { id: "5", subject: "Update all auth tests", description: "", status: "pending", blockedBy: ["3"] },
  { id: "6", subject: "Run full test suite and fix failures", description: "", status: "pending", blockedBy: ["5"] },
];

// ─── Playground Component ───────────────────────────────────────────────────

export function Playground() {
  const [darkMode, setDarkMode] = useState(
    () => document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="min-h-screen bg-cc-bg text-cc-fg font-sans-ui">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-cc-sidebar border-b border-cc-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-cc-fg tracking-tight">Component Playground</h1>
            <p className="text-xs text-cc-muted mt-0.5">Visual catalog of all UI components</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { window.location.hash = ""; }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cc-hover hover:bg-cc-active text-cc-fg border border-cc-border transition-colors cursor-pointer"
            >
              Back to App
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cc-primary/10 hover:bg-cc-primary/20 text-cc-primary border border-cc-primary/20 transition-colors cursor-pointer"
            >
              {darkMode ? "Light Mode" : "Dark Mode"}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-12">
        {/* ─── Permission Banners ──────────────────────────────── */}
        <Section title="Permission Banners" description="Tool approval requests shown above the composer">
          <div className="border border-cc-border rounded-xl overflow-hidden bg-cc-card divide-y divide-cc-border">
            <PermissionBanner permission={PERM_BASH} sessionId={MOCK_SESSION_ID} />
            <PermissionBanner permission={PERM_EDIT} sessionId={MOCK_SESSION_ID} />
            <PermissionBanner permission={PERM_WRITE} sessionId={MOCK_SESSION_ID} />
            <PermissionBanner permission={PERM_READ} sessionId={MOCK_SESSION_ID} />
            <PermissionBanner permission={PERM_GLOB} sessionId={MOCK_SESSION_ID} />
            <PermissionBanner permission={PERM_GREP} sessionId={MOCK_SESSION_ID} />
            <PermissionBanner permission={PERM_GENERIC} sessionId={MOCK_SESSION_ID} />
          </div>
        </Section>

        {/* ─── ExitPlanMode (the fix) ──────────────────────────── */}
        <Section title="ExitPlanMode" description="Plan approval request — previously rendered as raw JSON, now shows formatted markdown">
          <div className="border border-cc-border rounded-xl overflow-hidden bg-cc-card">
            <PermissionBanner permission={PERM_EXIT_PLAN} sessionId={MOCK_SESSION_ID} />
          </div>
        </Section>

        {/* ─── AskUserQuestion ──────────────────────────────── */}
        <Section title="AskUserQuestion" description="Interactive questions with selectable options">
          <div className="space-y-4">
            <Card label="Single question">
              <PermissionBanner permission={PERM_ASK_SINGLE} sessionId={MOCK_SESSION_ID} />
            </Card>
            <Card label="Multi-question">
              <PermissionBanner permission={PERM_ASK_MULTI} sessionId={MOCK_SESSION_ID} />
            </Card>
          </div>
        </Section>

        {/* ─── Messages ──────────────────────────────── */}
        <Section title="Messages" description="Chat message bubbles for all roles">
          <div className="space-y-4 max-w-3xl">
            <Card label="User message">
              <MessageBubble message={MSG_USER} />
            </Card>
            <Card label="User message with image">
              <MessageBubble message={MSG_USER_IMAGE} />
            </Card>
            <Card label="Assistant message (markdown)">
              <MessageBubble message={MSG_ASSISTANT} />
            </Card>
            <Card label="Assistant message (with tool calls)">
              <MessageBubble message={MSG_ASSISTANT_TOOLS} />
            </Card>
            <Card label="Assistant message (thinking block)">
              <MessageBubble message={MSG_ASSISTANT_THINKING} />
            </Card>
            <Card label="Tool result with error">
              <MessageBubble message={MSG_TOOL_ERROR} />
            </Card>
            <Card label="System message">
              <MessageBubble message={MSG_SYSTEM} />
            </Card>
          </div>
        </Section>

        {/* ─── Tool Blocks (standalone) ──────────────────────── */}
        <Section title="Tool Blocks" description="Expandable tool call visualization">
          <div className="space-y-2 max-w-3xl">
            <ToolBlock name="Bash" input={{ command: "git status && npm run lint" }} toolUseId="tb-1" />
            <ToolBlock name="Read" input={{ file_path: "/Users/stan/Dev/project/src/index.ts" }} toolUseId="tb-2" />
            <ToolBlock name="Edit" input={{ file_path: "src/utils.ts", old_string: "const x = 1;", new_string: "const x = 2;" }} toolUseId="tb-3" />
            <ToolBlock name="Write" input={{ file_path: "src/new-file.ts", content: 'export const hello = "world";\n' }} toolUseId="tb-4" />
            <ToolBlock name="Glob" input={{ pattern: "**/*.tsx" }} toolUseId="tb-5" />
            <ToolBlock name="Grep" input={{ pattern: "useEffect", path: "src/", glob: "*.tsx" }} toolUseId="tb-6" />
            <ToolBlock name="WebSearch" input={{ query: "React 19 new features" }} toolUseId="tb-7" />
          </div>
        </Section>

        {/* ─── Task Panel ──────────────────────────────── */}
        <Section title="Tasks" description="Task list states: pending, in progress, completed, blocked">
          <div className="w-[280px] border border-cc-border rounded-xl overflow-hidden bg-cc-card">
            {/* Session stats mock */}
            <div className="px-4 py-3 border-b border-cc-border space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-cc-muted uppercase tracking-wider">Cost</span>
                <span className="text-[13px] font-medium text-cc-fg tabular-nums">$0.1847</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-cc-muted uppercase tracking-wider">Context</span>
                  <span className="text-[11px] text-cc-muted tabular-nums">62%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-cc-hover overflow-hidden">
                  <div className="h-full rounded-full bg-cc-warning transition-all duration-500" style={{ width: "62%" }} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-cc-muted uppercase tracking-wider">Turns</span>
                <span className="text-[13px] font-medium text-cc-fg tabular-nums">14</span>
              </div>
            </div>
            {/* Task header */}
            <div className="px-4 py-2.5 border-b border-cc-border flex items-center justify-between">
              <span className="text-[12px] font-semibold text-cc-fg">Tasks</span>
              <span className="text-[11px] text-cc-muted tabular-nums">2/{MOCK_TASKS.length}</span>
            </div>
            {/* Task list */}
            <div className="px-3 py-2 space-y-0.5">
              {MOCK_TASKS.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          </div>
        </Section>

        {/* ─── Status Indicators ──────────────────────────────── */}
        <Section title="Status Indicators" description="Connection and session status banners">
          <div className="space-y-3 max-w-3xl">
            <Card label="Disconnected warning">
              <div className="px-4 py-2 bg-cc-warning/10 border border-cc-warning/20 rounded-lg text-center">
                <span className="text-xs text-cc-warning font-medium">Reconnecting to session...</span>
              </div>
            </Card>
            <Card label="Connected">
              <div className="flex items-center gap-2 px-3 py-2 bg-cc-card border border-cc-border rounded-lg">
                <span className="w-2 h-2 rounded-full bg-cc-success" />
                <span className="text-xs text-cc-fg font-medium">Connected</span>
                <span className="text-[11px] text-cc-muted ml-auto">claude-opus-4-6</span>
              </div>
            </Card>
            <Card label="Running / Thinking">
              <div className="flex items-center gap-2 px-3 py-2 bg-cc-card border border-cc-border rounded-lg">
                <span className="w-2 h-2 rounded-full bg-cc-primary animate-[pulse-dot_1.5s_ease-in-out_infinite]" />
                <span className="text-xs text-cc-fg font-medium">Thinking</span>
              </div>
            </Card>
            <Card label="Compacting">
              <div className="flex items-center gap-2 px-3 py-2 bg-cc-card border border-cc-border rounded-lg">
                <svg className="w-3.5 h-3.5 text-cc-muted animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
                </svg>
                <span className="text-xs text-cc-muted font-medium">Compacting context...</span>
              </div>
            </Card>
          </div>
        </Section>
      </div>
    </div>
  );
}

// ─── Shared Layout Helpers ──────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-cc-fg">{title}</h2>
        <p className="text-xs text-cc-muted mt-0.5">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-cc-border rounded-xl overflow-hidden bg-cc-card">
      <div className="px-3 py-1.5 bg-cc-hover/50 border-b border-cc-border">
        <span className="text-[10px] text-cc-muted font-mono-code uppercase tracking-wider">{label}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Inline TaskRow (avoids store dependency from TaskPanel) ────────────────

function TaskRow({ task }: { task: TaskItem }) {
  const isCompleted = task.status === "completed";
  const isInProgress = task.status === "in_progress";

  return (
    <div className={`px-2.5 py-2 rounded-lg ${isCompleted ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 flex items-center justify-center w-4 h-4 mt-px">
          {isInProgress ? (
            <svg className="w-4 h-4 text-cc-primary animate-spin" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
            </svg>
          ) : isCompleted ? (
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-cc-success">
              <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.354-9.354a.5.5 0 00-.708-.708L7 8.586 5.354 6.94a.5.5 0 10-.708.708l2 2a.5.5 0 00.708 0l4-4z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-cc-muted">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
        </span>
        <span className={`text-[13px] leading-snug flex-1 ${isCompleted ? "text-cc-muted line-through" : "text-cc-fg"}`}>
          {task.subject}
        </span>
      </div>
      {isInProgress && task.activeForm && (
        <p className="mt-1 ml-6 text-[11px] text-cc-muted italic truncate">{task.activeForm}</p>
      )}
      {task.blockedBy && task.blockedBy.length > 0 && (
        <p className="mt-1 ml-6 text-[11px] text-cc-muted flex items-center gap-1">
          <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3 shrink-0">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>blocked by {task.blockedBy.map((b) => `#${b}`).join(", ")}</span>
        </p>
      )}
    </div>
  );
}
