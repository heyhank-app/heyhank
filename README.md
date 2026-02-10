<p align="center">
  <img src="screenshot.png" alt="The Vibe Companion" width="100%" />
</p>

<h1 align="center">The Vibe Companion</h1>

<p align="center">
  <strong>An open-source web interface for Claude Code, built on an undocumented WebSocket protocol we reverse-engineered from the CLI.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/the-vibe-companion"><img src="https://img.shields.io/npm/v/the-vibe-companion.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/the-vibe-companion"><img src="https://img.shields.io/npm/dm/the-vibe-companion.svg" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://github.com/The-Vibe-Company/companion/stargazers"><img src="https://img.shields.io/github/stars/The-Vibe-Company/companion.svg?style=social" alt="GitHub Stars" /></a>
</p>

<br />

> Launch Claude Code sessions from your browser. Stream responses in real-time. Approve tool calls. Monitor multiple agents. No API key needed &mdash; uses your existing Claude Code subscription.

<br />

## Quick Start

> **Prerequisite:** [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

```bash
bunx the-vibe-companion
```

That's it. Open [http://localhost:3456](http://localhost:3456) and start coding.

<br />

---

<br />

## Features

**Multi-session management** &mdash; Launch multiple Claude Code sessions and switch between them. Each session runs in its own process with independent state, model, and permission settings.

**Real-time streaming** &mdash; Watch responses generate token by token over WebSocket. See elapsed time and output token count as the agent works.

**Tool call visualization** &mdash; Every tool call (Bash, Read, Edit, Write, Glob, Grep, WebSearch...) is displayed in collapsible blocks with syntax-highlighted content. See exactly what your agent is doing.

**Subagent task nesting** &mdash; When agents spawn sub-agents via the Task tool, their work renders nested under the parent with collapsed previews and a dedicated task panel.

**Live session stats** &mdash; Track cost (USD), context window usage, and turn count in real-time. A color-coded progress bar warns you as context fills up.

**Slash commands & image attachments** &mdash; Use `/` to access commands and skills with autocomplete. Paste or upload images directly into your messages.

**Dark mode** &mdash; Toggle between light and dark themes. Your preference persists across sessions.

<br />

---

<br />

## Environment Management

Manage environment variables across different projects without cluttering your shell. Environments are stored in `~/.companion/envs/` and can be applied to any session.

**Creating an environment:**

Via the web UI, use the environment manager to create named environments with variables:

```json
{
  "name": "My Project",
  "slug": "my-project",
  "variables": {
    "OPENAI_API_KEY": "sk-...",
    "DATABASE_URL": "postgresql://...",
    "NODE_ENV": "development"
  }
}
```

**Using an environment:**

When creating a session, specify the `envSlug` parameter to inject those variables into the Claude Code process:

```typescript
POST /api/sessions/create
{
  "envSlug": "my-project",
  "cwd": "/path/to/project"
}
```

This is ideal for managing API keys, database URLs, and other project-specific configuration without exposing them in your shell history.

<br />

---

<br />

## Session Persistence & Recovery

Sessions are automatically persisted to disk and restored when the server restarts. Your work is never lost.

**Automatic persistence:**

- Session state is saved to `~/.companion/sessions/` after each message
- On server restart, all active sessions are restored automatically
- Session history is preserved across restarts

**Auto-reconnection:**

- If the CLI process exits (crash, manual kill, etc.), the server maintains the session state
- When you refresh the browser or reconnect, the server automatically relaunches the CLI with `--resume`
- The conversation context is restored using Claude Code's built-in resume capability

**Session ID mapping:**

- External session IDs (used in URLs) are mapped to internal CLI session IDs
- This abstraction allows seamless recovery and reconnection

<br />

---

<br />

## Permission Modes

Control how tools are approved on a per-session basis. Choose the level of automation that matches your workflow.

| Mode | Description |
|------|-------------|
| `bypass` | Auto-approve all tool calls. No prompts. |
| `acceptEdits` | Auto-approve Read, Write, and Edit tools. Prompt for everything else. |
| `plan` | Plan-only mode. Agent can explore read-only but requires approval for writes. |
| `default` | Manual control. Prompt for every tool call. |

**Tool allowlists:**

Restrict which tools the agent can use with the `allowedTools` parameter:

```typescript
POST /api/sessions/create
{
  "permissionMode": "default",
  "allowedTools": ["Read", "Grep", "Glob"]  // Read-only access
}
```

<br />

---

<br />

## File System Browsing

Browse and select working directories directly from the web interface.

**Available endpoints:**

- `GET /fs/home` &mdash; Returns the user's home directory path
- `GET /fs/list?path=/path/to/dir` &mdash; Lists contents of a directory

**Directory listing response:**

```json
{
  "path": "/Users/stan/projects",
  "entries": [
    { "name": "my-app", "type": "directory" },
    { "name": "README.md", "type": "file" }
  ]
}
```

This enables the folder browser UI in session creation, allowing you to navigate to any project directory before launching a session.

<br />

---

<br />

## Status Line Integration

The Vibe Companion supports Claude Code's built-in `statusLine` API for real-time monitoring of agent activity.

**What gets tracked:**

- Model display name
- Context window usage percentage
- Total cost in USD
- Total duration in milliseconds
- Lines added/removed

**Configuration:**

Create `.claude/settings.local.json` in your working directory:

```json
{
  "statusLine": {
    "type": "command",
    "command": "echo '{\"session\": \"$SESSION_ID\"}'"
  }
}
```

The server receives status updates after each message and can forward them to monitoring systems or display them in the UI.

<br />

---

<br />

## API Reference

### Sessions

#### Create a session

```typescript
POST /api/sessions/create

{
  model?: string              // Default: "claude-sonnet-4-5-20250929"
  permissionMode?: "bypass" | "acceptEdits" | "plan" | "default"
  cwd?: string                // Working directory
  envSlug?: string            // Environment to apply
  allowedTools?: string[]     // Tool allowlist
}

Response: { sessionId: string }
```

#### List sessions

```typescript
GET /api/sessions

Response: [
  {
    sessionId: string
    model: string
    permissionMode: string
    cwd: string
    status: "idle" | "busy"
    createdAt: string
  }
]
```

#### Delete a session

```typescript
DELETE /api/sessions/:sessionId

Response: { success: boolean }
```

### WebSocket Endpoints

- `/ws/cli/:sessionId` &mdash; Claude Code CLI connects here
- `/ws/browser/:sessionId` &mdash; Browser connects here

The server bridges messages bidirectionally between these endpoints.

### File System

- `GET /fs/home` &mdash; Get user home directory
- `GET /fs/list?path=:directory` &mdash; List directory contents

<br />

---

<br />

## How It Works

Claude Code CLI has a **hidden `--sdk-url` flag** that makes it connect to an external WebSocket server instead of running in a terminal. We reverse-engineered the NDJSON protocol it speaks and built a web server that bridges it to your browser.

```
                     WebSocket (NDJSON)              WebSocket (JSON)
┌──────────────┐    /ws/cli/:session         ┌─────────────────┐    /ws/browser/:session    ┌─────────────┐
│  Claude Code │ ◄──────────────────────────► │   Bun + Hono    │ ◄────────────────────────► │   Browser   │
│     CLI      │                              │     Server      │                            │  (React)    │
└──────────────┘                              └─────────────────┘                            └─────────────┘
                                               │
                                               ├─ Spawns CLI processes
                                               ├─ Routes messages bidirectionally
                                               ├─ Manages permission flow
                                               └─ Tracks session state & history
```

**The flow:**

1. You type a prompt in the browser
2. The server spawns `claude --sdk-url ws://localhost:3456/ws/cli/SESSION_ID --print --output-format stream-json`
3. The CLI connects back to the server over WebSocket
4. Messages flow both ways: your prompts go to the CLI, streaming responses come back to your browser
5. When the CLI wants to run a tool, it sends a permission request &mdash; the server forwards it to your browser for approval

<br />

---

<br />

## The Protocol

This project exists because we found something interesting buried in the Claude Code CLI binary: a hidden `--sdk-url` flag (`.hideHelp()` in Commander) that switches the CLI from terminal mode to WebSocket client mode.

The protocol it speaks is **NDJSON** (newline-delimited JSON) &mdash; the same format used internally by the official `@anthropic-ai/claude-agent-sdk`. We reverse-engineered the full specification:

- **13 control request subtypes** (initialize, can_use_tool, interrupt, set_model, MCP operations, and more)
- **Permission flow** for tool approval/denial with input editing
- **Streaming events** for token-by-token response delivery
- **Session lifecycle** management and reconnection logic

The complete protocol specification is documented in [`WEBSOCKET_PROTOCOL_REVERSED.md`](WEBSOCKET_PROTOCOL_REVERSED.md).

<br />

---

<br />

## Configuration

### Environment Variables

Create a `.env` file in the project root (see `.env.example`):

```bash
# Server
PORT=3456

# Optional: Custom Claude binary path
CLAUDE_BINARY_PATH=/usr/local/bin/claude
```

### Claude Code Settings

The Companion respects your existing Claude Code configuration in `~/.claude/`:

- `settings.json` &mdash; Global settings
- `settings.local.json` &mdash; Project-local settings
- `.env` files &mdash; Environment variables

### Working Directory

Each session can have its own working directory. Use the file browser to select a project folder, or specify `cwd` when creating a session programmatically.

<br />

---

<br />

## Troubleshooting

### CLI won't connect

**Problem:** Session shows "connecting" but never becomes active.

**Solutions:**
- Verify Claude Code CLI is installed: `claude --version`
- Check authentication: `claude auth status`
- Ensure no firewall is blocking localhost connections
- Check browser console for WebSocket errors

### Session lost after refresh

**Problem:** Session disappears when refreshing the page.

**Solutions:**
- Sessions are stored in memory and restored on server restart
- If the server restarted, the session should auto-recover
- Check server logs for errors during session restoration

### Permission prompts not appearing

**Problem:** Tool calls execute without prompting.

**Solutions:**
- Check your `permissionMode` setting (may be set to `bypass`)
- Verify `allowedTools` isn't restricting the tools you expect to prompt for

### High memory usage

**Problem:** Server memory grows over time.

**Solutions:**
- Sessions with long histories consume more memory
- Consider terminating old sessions: `DELETE /api/sessions/:id`
- Restart the server to clear all session state

<br />

---

<br />

## Development

```bash
git clone https://github.com/The-Vibe-Company/companion.git
cd companion/web
bun install
bun run dev          # server on :3456 + Vite on :5174
```

Open [http://localhost:5174](http://localhost:5174) for hot-reloading development.

For production builds:

```bash
bun run build && bun run start   # everything on :3456
```

<br />

---

<br />

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| Server | [Hono](https://hono.dev) + native Bun WebSocket |
| Frontend | [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org) |
| State | [Zustand](https://github.com/pmndrs/zustand) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Build | [Vite](https://vite.dev) |

<br />

---

<br />

## Roadmap

The Vibe Companion started as a way to control Claude Code from the browser. But the vision is bigger:

**An open-source web interface for AI coding agents, compatible with any LLM provider.**

What's coming:

- Support for additional LLM providers beyond Anthropic
- Bring-your-own-API-key mode
- Collaborative multi-user sessions
- Plugin system for custom tool integrations
- Self-hosted deployment with Docker

If you want to help shape the future of AI-assisted development, contributions are welcome.

<br />

---

<br />

## Contributing

Contributions are welcome! Please:

1. Check existing [GitHub Issues](https://github.com/The-Vibe-Company/companion/issues)
2. Fork the repository and create a feature branch
3. Follow the existing code style and patterns
4. Test your changes thoroughly
5. Submit a pull request with a clear description

For protocol-level contributions, refer to [`WEBSOCKET_PROTOCOL_REVERSED.md`](WEBSOCKET_PROTOCOL_REVERSED.md) for the full specification.

<br />

---

<br />

## License

MIT &copy; [The Vibe Company](https://github.com/The-Vibe-Company)
