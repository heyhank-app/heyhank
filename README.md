<p align="center">
  <h1 align="center">claude-code-controller</h1>
  <p align="center">
    <strong>Spawn, orchestrate, and control Claude Code agents — programmatically.</strong>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/claude-code-controller"><img src="https://img.shields.io/npm/v/claude-code-controller" alt="npm" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node >= 18" /></a>
  </p>
</p>

<br />

<p align="center">
  <img src="screenshot.png" alt="Claude Code Controller — Web Dashboard" width="100%" />
</p>

<br />

> **Three lines of code.** Ask Claude a question, get an answer. Spin up persistent agents for multi-turn conversations. Orchestrate entire teams of agents working in parallel. All running **real Claude Code** — the same one you use in your terminal every day.

<br />

---

<br />

## Quick Start

```bash
npm install claude-code-controller
```

> **Prerequisite:** [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) v2.1.34+

<br />

### One-liner — ask a question, get an answer

```typescript
import { claude } from "claude-code-controller";

const answer = await claude("What does this project do?", { model: "sonnet" });
console.log(answer);
```

That's it. No initialization, no boilerplate, no `sleep()` hacks. The agent is created, responds, and cleans up automatically.

<br />

### Persistent agent — multi-turn conversations

```typescript
const agent = await claude.agent({ model: "sonnet", cwd: "/my/project" });

const review = await agent.ask("Review src/auth.ts for security issues");
const fixes = await agent.ask("Now fix the issues you found");

await agent.close();
```

The agent retains full context between calls. Ask follow-up questions, build on previous answers, iterate on a task — like pairing with a colleague.

<br />

### Multi-agent session — parallel teams

```typescript
const session = await claude.session({ model: "sonnet" });

const reviewer = await session.agent("reviewer", { model: "opus" });
const coder = await session.agent("coder");

const issues = await reviewer.ask("Review src/ for security vulnerabilities");
await coder.ask(`Fix these issues:\n${issues}`);

await session.close();
```

Each agent has its own process, its own context, its own model. They work in parallel on your codebase. One reviews, another codes, another writes tests — all at the same time.

<br />

### Auto-cleanup with `await using`

```typescript
{
  await using agent = await claude.agent({ model: "sonnet" });
  const answer = await agent.ask("What is 2+2?");
} // agent.close() called automatically
```

<br />

---

<br />

## Why this instead of the Agent SDK?

This runs **real Claude Code processes**. Not a wrapper around the API. Not a simplified `-p` mode. Actual Claude Code — the same one you use in your terminal every day.

That means:

- **Uses your Claude Code subscription** — No separate API key needed. No usage-based billing surprise. If you have a Max plan, your agents run on it.
- **Day 0 features** — When Anthropic ships a new Claude Code feature (new tools, new models, better context handling), you get it immediately. No library update needed. No waiting for SDK support.
- **Full tool access** — Bash, Read, Write, Edit, Glob, Grep, WebSearch, Task sub-agents... everything Claude Code can do, your agents can do.
- **Real terminal environment** — Agents run in a PTY. They can install packages, run tests, use git, call APIs. They work in your actual project directory.
- **Battle-tested agent loop** — Claude Code's agent loop is production-hardened. You get all of that for free: retries, error handling, tool orchestration, context management.

<br />

---

<br />

## Features

- **3 lines of code** — From zero to a working agent in seconds. No boilerplate, no two-step initialization.
- **Multi-turn conversations** — Persistent agents that remember context across `ask()` calls.
- **Multi-agent sessions** — Orchestrate teams of agents working in parallel on the same codebase.
- **Permission control** — Four presets from full-access to ask-before-every-tool. Auto-approve, allowlists, or inline callbacks.
- **First-class API key support** — Pass `apiKey` and `baseUrl` directly. No env var wiring.
- **REST API** — Control everything over HTTP. Works from any language, any platform.
- **Web Dashboard** — Real-time monitoring, agent management, and interactive approvals from your browser.
- **Task management** — Create tasks, assign them to agents, track progress, define blocking dependencies.
- **`await using` support** — Automatic cleanup with `Symbol.asyncDispose`.
- **Any provider** — Point agents at any Anthropic-compatible endpoint. Per-agent overrides.
- **Your subscription** — Runs on your existing Claude Code plan. No separate API costs.

<br />

---

<br />

## Permission Control

Every agent gets a permission preset that controls what tools it can use without asking.

| Preset | Behavior |
|--------|----------|
| `"full"` (default) | All tools, no approval needed |
| `"edit"` | Auto-approve read/write/bash |
| `"plan"` | Read-only exploration |
| `"ask"` | Fires events for every tool use |

```typescript
// Full access (default)
const agent = await claude.agent({ permissions: "full" });

// Read-only explorer
const agent = await claude.agent({ permissions: "plan" });

// Ask-mode with auto-approve for safe tools
const agent = await claude.agent({
  permissions: "ask",
  autoApprove: ["Read", "Glob", "Grep"],
});

// Auto-approve everything (YOLO mode)
const agent = await claude.agent({
  permissions: "ask",
  autoApprove: true,
});
```

<br />

### Inline callbacks

Handle permission and plan requests with simple callbacks:

```typescript
const agent = await claude.agent({
  permissions: "ask",
  onPermission: (req) => {
    console.log(`Tool: ${req.toolName} — ${req.description}`);
    req.toolName === "Bash" ? req.reject() : req.approve();
  },
  onPlan: (req) => {
    console.log("Plan:", req.planContent);
    req.approve();
  },
});
```

<br />

### Event-based

Or use the event emitter pattern for more control:

```typescript
const agent = await claude.agent({ permissions: "ask" });

agent.on("permission", (req) => {
  const safe = ["Read", "Glob", "Grep"].includes(req.toolName);
  safe ? req.approve() : req.reject();
});

agent.on("plan", (req) => {
  req.approve();
});

agent.on("message", (text) => console.log(text));
agent.on("error", (err) => console.error(err));
agent.on("exit", (code) => console.log("Agent exited:", code));
```

<br />

---

<br />

## REST API

Control Claude Code agents from **any language, any platform** — just HTTP.

<br />

### Start a server

```typescript
import { createApi } from "claude-code-controller/api";

const app = createApi();
Bun.serve({ port: 3000, fetch: app.fetch });
```

<br />

### One-liner over HTTP

```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What does this project do?", "model": "sonnet"}'
# → { "response": "This project is a..." }
```

<br />

### Endpoints

#### Ask (one-liner)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/ask` | Send a prompt, get a response. Creates an ephemeral agent. |

#### Session

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Server health & uptime |
| `GET` | `/session` | Current session info |
| `POST` | `/session/init` | Initialize a new controller session |
| `POST` | `/session/shutdown` | Shut down the controller |

#### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/agents` | List all agents |
| `POST` | `/agents` | Spawn a new agent |
| `GET` | `/agents/:name` | Get agent details |
| `POST` | `/agents/:name/messages` | Send a message to an agent |
| `POST` | `/agents/:name/kill` | Force-kill an agent |
| `POST` | `/agents/:name/shutdown` | Request graceful shutdown |
| `POST` | `/agents/:name/approve` | Approve or reject a plan or permission request |

#### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/tasks` | List all tasks |
| `POST` | `/tasks` | Create a new task |
| `GET` | `/tasks/:id` | Get task details |
| `PATCH` | `/tasks/:id` | Update a task |
| `DELETE` | `/tasks/:id` | Delete a task |
| `POST` | `/tasks/:id/assign` | Assign task to an agent |

#### Actions & Broadcasting

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/actions` | All pending actions (approvals, idle agents, unassigned tasks) |
| `POST` | `/broadcast` | Send a message to all agents |

<br />

### API Examples

**Initialize a session with API key:**

```bash
curl -X POST http://localhost:3000/session/init \
  -H "Content-Type: application/json" \
  -d '{"teamName": "my-team", "apiKey": "sk-ant-...", "baseUrl": "https://api.example.com"}'
```

**Spawn an agent with permissions:**

```bash
curl -X POST http://localhost:3000/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "reviewer", "model": "opus", "permissions": "edit"}'
```

**Send a message:**

```bash
curl -X POST http://localhost:3000/agents/reviewer/messages \
  -H "Content-Type: application/json" \
  -d '{"message": "Review src/auth.ts for security vulnerabilities"}'
```

**Create and assign a task:**

```bash
# Create
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"subject": "Fix login bug", "description": "Users cannot login with SSO"}'

# Assign
curl -X POST http://localhost:3000/tasks/1/assign \
  -H "Content-Type: application/json" \
  -d '{"agent": "reviewer"}'
```

<br />

---

<br />

## Web Dashboard

A built-in web UI for real-time agent management — no code required.

```bash
cd web && bun install
```

**Development:**

```bash
bun run dev          # backend on :3456
bun run dev:vite     # frontend on :5174
```

**Production:**

```bash
bun run build && bun run start   # everything on :3456
```

The dashboard gives you:

- **Session management** — Initialize with API key, base URL, team name, and working directory
- **Agent spawning** — Configure name, type, model, and permission level from a dropdown
- **Live message feed** — Real-time messages via WebSocket
- **Approval prompts** — Interactive plan and permission approval banners
- **Agent controls** — Shutdown or kill agents individually

<br />

---

<br />

## Real-World Examples

### Parallel Code Review

```typescript
import { claude } from "claude-code-controller";

const session = await claude.session({ model: "sonnet" });

const [security, perf, style] = await Promise.all([
  session.agent("security", { model: "opus" }),
  session.agent("perf"),
  session.agent("style", { model: "haiku" }),
]);

const reviews = await Promise.all([
  security.ask("Review src/ for security vulnerabilities"),
  perf.ask("Review src/ for performance issues"),
  style.ask("Review src/ for code style issues"),
]);

console.log("Security:", reviews[0]);
console.log("Performance:", reviews[1]);
console.log("Style:", reviews[2]);

await session.close();
```

### Task-Based Workflow

```typescript
import { claude, Session } from "claude-code-controller";

const session = await claude.session({ model: "sonnet" });
const worker = await session.agent("worker");

// Create and assign a task via the underlying controller
const taskId = await session.controller.createTask({
  subject: "Add input validation",
  description: "Add zod validation to all API route handlers in src/routes/",
  owner: "worker",
});

const result = await session.controller.waitForTask(taskId, 120_000);
console.log(`Task ${result.status}: ${result.subject}`);

await session.close();
```

### Custom API Provider

```typescript
const agent = await claude.agent({
  model: "sonnet",
  apiKey: "sk-ant-...",
  baseUrl: "https://your-proxy.example.com/api/anthropic",
});

const answer = await agent.ask("What framework is this project using?");
await agent.close();
```

### Selective Permission Control

```typescript
const agent = await claude.agent({
  permissions: "ask",
  onPermission: (req) => {
    const safe = ["Read", "Glob", "Grep", "Task"].includes(req.toolName);
    const review = ["Bash", "Write", "Edit"].includes(req.toolName);

    if (safe) {
      req.approve();
    } else if (review) {
      console.log(`[REVIEW] ${req.toolName}: ${req.description}`);
      req.approve(); // or implement your own review logic
    } else {
      req.reject();
    }
  },
});
```

<br />

---

<br />

## Advanced: Full Controller

The simplified API is built on top of `ClaudeCodeController` — a full-featured class that gives you direct access to the teammate protocol. Use it when you need low-level control over team configuration, inbox polling, or process management.

```typescript
import { ClaudeCodeController } from "claude-code-controller";

const ctrl = new ClaudeCodeController({
  teamName: "my-team",
  cwd: "/path/to/project",
  env: {
    ANTHROPIC_BASE_URL: "https://your-proxy.example.com",
    ANTHROPIC_AUTH_TOKEN: "sk-ant-...",
  },
  logLevel: "info",
});

await ctrl.init();
```

### Spawning Agents

```typescript
const agent = await ctrl.spawnAgent({
  name: "coder",
  type: "general-purpose",
  model: "sonnet",
  permissionMode: "bypassPermissions",
  env: { MY_VAR: "value" },
});
```

### AgentHandle

```typescript
await agent.send("Analyze the codebase structure.");
const response = await agent.receive({ timeout: 30_000 });

const answer = await agent.ask("What framework is this project using?", {
  timeout: 60_000,
});

agent.isRunning;         // boolean
agent.pid;               // process ID
await agent.shutdown();  // graceful
await agent.kill();      // force
```

### Messaging

```typescript
await ctrl.send("agent-name", "Your instructions here");
await ctrl.broadcast("Everyone stop and report status.");
const msg = await ctrl.receiveAny({ timeout: 30_000 });
```

### Task Management

```typescript
const taskId = await ctrl.createTask({
  subject: "Add input validation",
  description: "Add zod schemas to all API endpoints",
  owner: "coder",
});

await ctrl.assignTask(taskId, "coder");
const task = await ctrl.waitForTask(taskId, 120_000);
```

### Events

```typescript
ctrl.on("message", (agent, msg) => console.log(`[${agent}] ${msg.text}`));
ctrl.on("plan:approval_request", (agent, msg) => {
  ctrl.sendPlanApproval(agent, msg.requestId, true);
});
ctrl.on("permission:request", (agent, msg) => {
  ctrl.sendPermissionResponse(agent, msg.requestId, true);
});
ctrl.on("agent:spawned", (name, pid) => console.log(`${name} started`));
ctrl.on("agent:exited", (name, code) => console.log(`${name} exited`));
ctrl.on("idle", (name) => console.log(`${name} is idle`));
ctrl.on("task:completed", (task) => console.log(`Done: ${task.subject}`));
```

<br />

---

<br />

## How It Works

Claude Code has an internal "teammate" protocol that uses the filesystem for communication. This library creates the required files, spawns real Claude Code CLI processes via PTY, and communicates with them through inbox files. Agents think they're in a normal team and behave naturally.

```
~/.claude/
├── teams/{teamName}/
│   ├── config.json                    # Team membership & config
│   └── inboxes/
│       ├── controller.json            # Messages TO controller FROM agents
│       ├── agent-1.json               # Messages TO agent-1 FROM controller
│       └── agent-2.json               # Messages TO agent-2 FROM controller
└── tasks/{teamName}/
    ├── 1.json                         # Task files
    └── 2.json
```

**Architecture:**

```
ClaudeCodeController
├── TeamManager        → Team config CRUD
├── TaskManager        → Task lifecycle management
├── ProcessManager     → PTY-based process spawning
├── InboxPoller        → Polls controller inbox for agent messages
└── AgentHandle[]      → Per-agent convenience wrappers
```

**The flow:**

1. **Spawn** — Calls `claude --teammate-mode auto --agent-id name@team ...` via a PTY wrapper
2. **Register** — Agent is registered in the team config with its role, model, and permissions
3. **Communicate** — Controller writes to `inboxes/{agent}.json`, agent writes to `inboxes/controller.json`
4. **Poll** — InboxPoller reads the controller inbox every 500ms and fires events
5. **Lock** — All file operations use `proper-lockfile` to prevent corruption from concurrent access

<br />

---

<br />

## Development

```bash
bun install          # install deps
bun test             # run tests
bun run typecheck    # type check
bun run build        # build for distribution
```

<br />

---

<br />

## License

MIT
