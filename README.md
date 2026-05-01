<p align="center">
  <img src="web/public/logo.svg" alt="HeyHank" width="80" />
</p>

<h1 align="center">HeyHank</h1>
<p align="center"><strong>Self-hosted web UI for running Claude Code agents.</strong></p>
<p align="center">Multi-session management with streaming, tool call visibility, and permission control. Codex CLI is also supported as a secondary backend.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/heyhank"><img src="https://img.shields.io/npm/v/heyhank.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/heyhank"><img src="https://img.shields.io/npm/dm/heyhank.svg" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
</p>

## Quick Start

**Requirements:** [Bun](https://bun.sh) v1.0+ and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (primary). [Codex](https://github.com/openai/codex) CLI is optionally supported as a secondary backend.

```bash
bunx heyhank
```

Open [http://localhost:3456](http://localhost:3456).

### Install Globally

```bash
bun install -g heyhank

# Register as a background service (launchd on macOS, systemd on Linux)
heyhank install

# Start the service
heyhank start
```

## Features

- **Multi-Session Chat** — Run multiple Claude Code sessions simultaneously (Codex as a secondary backend)
- **Skill Marketplace** — Browse and install Claude Code skills from curated GitHub sources straight into `~/.claude/skills/`
- **Gemini Live Voice Assistant** — Hands-free voice control with tool calling
- **Scheduled Agents** — Cron-based agent automation
- **Media Generation** — Image (Imagen 4) and video (Veo 3.1) generation
- **Social Media** — Multi-backend posting (Postiz, Buffer, Ayrshare)
- **Email Integration** — Multi-account IMAP/SMTP email via UI and voice
- **Telephony** — Voice calls via FreeSWITCH SIP integration
- **Personal Assistant** — Todos, notes, and reminders managed by voice or UI
- **Federation** — Connect multiple HeyHank instances across machines
- **Tailscale Funnel** — Public HTTPS access without port forwarding
- **PWA** — Installable on mobile and desktop

## CLI Commands

| Command | Description |
|---|---|
| `heyhank` | Start server in foreground (default) |
| `heyhank serve` | Start server in foreground (explicit) |
| `heyhank install` | Register as a background service (launchd/systemd) |
| `heyhank start` | Start the background service |
| `heyhank stop` | Stop the background service |
| `heyhank restart` | Restart the background service |
| `heyhank uninstall` | Remove the background service |
| `heyhank status` | Show service status |
| `heyhank logs` | Tail service log files |

**Options:** `--port <n>` overrides the default port (3456).

## Architecture

```
Browser (React)
  <-> ws://localhost:3456/ws/browser/:session
HeyHank Server (Bun + Hono)
  <-> ws://localhost:3456/ws/cli/:session
Claude Code CLI (primary)  /  Codex CLI (secondary)
```

The server bridges the CLI's `--sdk-url` WebSocket (NDJSON) to a browser-friendly WebSocket.

## Authentication

The server auto-generates an auth token on first start, stored at `~/.heyhank/auth.json`.

```bash
# Show the current token
cd web && bun run generate-token

# Force-regenerate a new token
cd web && bun run generate-token --force
```

Or set via environment variable:

```bash
HEYHANK_AUTH_TOKEN="my-secret-token" bunx heyhank
```

## Development

```bash
cd web
bun install
bun run dev
```

Checks:

```bash
cd web
bun run typecheck
bun run test
```

## License

MIT
