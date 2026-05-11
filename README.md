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

| Feature | Required to use it |
|---|---|
| **Multi-Session Chat** — multiple Claude Code / Codex sessions in parallel | Bun + Claude Code CLI (or Codex CLI) — **default, no extra setup** |
| **Skill Marketplace** — install Claude Code skills from curated GitHub sources | nothing extra |
| **Personal Assistant** — todos, notes, reminders | nothing extra |
| **Scheduled Agents** — cron-based agent automation | nothing extra |
| **Hank-UI Chat** — provider-agnostic chat (Claude / Codex / Gemini / Ollama / OpenRouter) | API key for the provider you pick |
| **Memory** — local semantic search over notes & conversations | nothing extra (uses local `vectra` + `transformers.js`) |
| **PWA** — installable on mobile/desktop | nothing extra |
| **Gemini Live Voice Assistant** — hands-free voice control with tool calling | `GEMINI_API_KEY` |
| **Media Generation** — Imagen 4 images, Veo 3.1 videos | `GEMINI_API_KEY` with media access |
| **Email Integration** — IMAP/SMTP via UI and voice | per-account IMAP/SMTP credentials, configured in the UI |
| **Calendar** — read/write events via voice | Google Cloud project + service account (Calendar scope) |
| **Voice Pipeline** — low-latency telephony (Google STT/TTS + LLM) | Google Cloud project + service account (Speech scope), Groq or other LLM key |
| **Telephony** — voice calls via FreeSWITCH SIP | self-hosted FreeSWITCH (Docker compose in `freeswitch/`) + a SIP trunk provider |
| **Social Media** — multi-backend posting | self-hosted [Postiz](https://github.com/gitroomhq/postiz-app) (recommended), or Buffer / Ayrshare account |
| **Federation** — connect multiple HeyHank instances | a relay server reachable by all nodes (`HEYHANK_RELAY_URL` + `HEYHANK_RELAY_SECRET`) |
| **Tailscale Funnel** — public HTTPS without port forwarding | a Tailscale account with Funnel enabled |

See [`web/.env.example`](web/.env.example) for every supported environment variable, grouped by feature.

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
