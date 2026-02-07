# claude-code-controller

Programmatic TypeScript API to pilot [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agents. Spawn, message, and orchestrate multiple Claude Code teammates from your own code — without using `-p` mode or the Agent SDK.

This library exploits Claude Code's internal filesystem-based **teams/inbox/tasks** protocol to offer a clean interface for spawning agents, sending instructions, and receiving responses.

## How it works

Claude Code has an internal "teammate" system that uses the filesystem for inter-agent communication:

- **Teams** — `~/.claude/teams/{name}/config.json` stores team membership
- **Inboxes** — `~/.claude/teams/{name}/inboxes/{agent}.json` for message passing
- **Tasks** — `~/.claude/tasks/{name}/{id}.json` for task tracking

This library wraps that protocol and spawns real Claude Code TUI processes (via a PTY wrapper) in teammate mode, giving you full programmatic control.

## Install

```bash
bun add claude-code-controller
# or
npm install claude-code-controller
```

> **Requires**: Claude Code CLI v2.1.34+ installed and the env variable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` set in your shell.

## Quick Start

```typescript
import { ClaudeCodeController } from "claude-code-controller";

const ctrl = new ClaudeCodeController({
  teamName: "my-project",
});

await ctrl.init();

// Spawn an agent
const agent = await ctrl.spawnAgent({
  name: "worker",
  type: "general-purpose",
  model: "sonnet",
});

// Wait for it to boot
await new Promise((r) => setTimeout(r, 10_000));

// Ask a question and get a response
const answer = await agent.ask(
  "What is 2+2? Reply using SendMessage.",
  { timeout: 60_000 }
);
console.log(answer); // "4"

// Clean up
await ctrl.shutdown();
```

## Custom Environment Variables

You can inject environment variables into agent processes. This is useful for routing agents through alternative API providers (e.g. z.ai for GLM models):

```typescript
const ctrl = new ClaudeCodeController({
  teamName: "custom-env",
  // Default env vars for all agents
  env: {
    ANTHROPIC_AUTH_TOKEN: "your-api-key",
    ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
  },
});

await ctrl.init();

// Per-agent overrides (takes precedence over defaults)
const agent = await ctrl.spawnAgent({
  name: "worker",
  env: {
    ANTHROPIC_AUTH_TOKEN: "different-key-for-this-agent",
  },
});
```

## API

### `ClaudeCodeController`

The main entry point. Manages the team, agents, tasks, and messaging.

```typescript
const ctrl = new ClaudeCodeController({
  teamName?: string,       // default: random UUID-based name
  cwd?: string,            // working directory for agents
  claudeBinary?: string,   // path to claude binary (default: "claude")
  env?: Record<string, string>,  // default env vars for all agents
  logLevel?: "debug" | "info" | "warn" | "error" | "silent",
});
```

#### Lifecycle

| Method | Description |
|--------|-------------|
| `ctrl.init()` | Initialize the controller (must be called first) |
| `ctrl.shutdown()` | Graceful shutdown: send shutdown requests, wait, kill remaining, clean up |

#### Agent Management

| Method | Description |
|--------|-------------|
| `ctrl.spawnAgent(opts)` | Spawn a new Claude Code agent, returns `AgentHandle` |
| `ctrl.isAgentRunning(name)` | Check if an agent process is alive |
| `ctrl.killAgent(name)` | Force-kill an agent |

#### Messaging

| Method | Description |
|--------|-------------|
| `ctrl.send(agent, message, summary?)` | Send a message to an agent |
| `ctrl.broadcast(message, summary?)` | Send to all agents |
| `ctrl.receive(agent, opts?)` | Wait for messages from a specific agent |
| `ctrl.receiveAny(opts?)` | Wait for a message from any agent |

#### Tasks

| Method | Description |
|--------|-------------|
| `ctrl.createTask({ subject, description, owner? })` | Create a task (notifies owner) |
| `ctrl.assignTask(taskId, agentName)` | Assign a task to an agent |
| `ctrl.waitForTask(taskId, timeout?)` | Wait for task completion |

#### Protocol Responses

| Method | Description |
|--------|-------------|
| `ctrl.sendPlanApproval(agent, requestId, approve, feedback?)` | Approve/reject a plan |
| `ctrl.sendPermissionResponse(agent, requestId, approve)` | Approve/reject a permission request |
| `ctrl.sendShutdownRequest(agent)` | Request graceful shutdown |

### `AgentHandle`

Proxy object returned by `spawnAgent()`. Simplifies interaction with a single agent.

```typescript
await agent.send(message, summary?)  // Send a message
await agent.receive(opts?)           // Wait for response (returns text)
await agent.ask(question, opts?)     // Send + receive in one call
await agent.shutdown()               // Request graceful shutdown
await agent.kill()                   // Force kill
agent.isRunning                      // Check if alive
agent.name                           // Agent name
agent.pid                            // Process PID
```

### Events

The controller is an `EventEmitter`:

```typescript
ctrl.on("message", (agentName, message) => { ... });
ctrl.on("idle", (agentName) => { ... });
ctrl.on("shutdown:approved", (agentName, msg) => { ... });
ctrl.on("plan:approval_request", (agentName, msg) => { ... });
ctrl.on("permission:request", (agentName, msg) => { ... });
ctrl.on("agent:spawned", (agentName, pid) => { ... });
ctrl.on("agent:exited", (agentName, code) => { ... });
```

## Architecture

```
ClaudeCodeController
├── TeamManager        — CRUD for ~/.claude/teams/{name}/config.json
├── TaskManager        — CRUD for ~/.claude/tasks/{name}/{id}.json
├── ProcessManager     — Spawns claude CLI in PTY via Python wrapper
├── InboxPoller        — Polls controller's inbox for agent messages
└── AgentHandle        — Per-agent proxy (send/receive/ask)
```

### Protocol Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| Plain text (SendMessage) | Agent → Controller | Agent's response |
| `idle_notification` | Agent → Controller | Agent finished its turn |
| `task_assignment` | Controller → Agent | Assign work |
| `shutdown_request` | Controller → Agent | Request shutdown |
| `shutdown_approved` | Agent → Controller | Shutdown acknowledged |
| `plan_approval_request` | Agent → Controller | Agent wants plan approved |
| `plan_approval_response` | Controller → Agent | Approve/reject plan |
| `permission_request` | Agent → Controller | Agent needs tool permission |
| `permission_response` | Controller → Agent | Approve/reject permission |

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Build
bun run build
```

## License

MIT
