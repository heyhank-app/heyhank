<p align="center">
  <h1 align="center">The Vibe Companion</h1>
  <p align="center">
    <strong>A web UI for launching and interacting with Claude Code agents.</strong>
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
  </p>
</p>

<br />

<p align="center">
  <img src="screenshot.png" alt="The Vibe Companion — Web Dashboard" width="100%" />
</p>

<br />

> Launch Claude Code sessions from your browser. Send messages, view responses in real-time, approve tool calls, and monitor multiple agents — all through a clean web interface.

<br />

---

<br />

## Quick Start

> **Prerequisite:** [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

```bash
cd web && bun install
```

**Development:**

```bash
bun run dev          # backend + frontend on :5174
```

**Production:**

```bash
bun run build && bun run start   # everything on :3456
```

Open [http://localhost:5174](http://localhost:5174) (dev) or [http://localhost:3456](http://localhost:3456) (prod).

<br />

---

<br />

## Features

- **Session management** — Launch Claude Code sessions with configurable model, permission mode, and working directory
- **Real-time message feed** — Stream assistant responses via WebSocket as they're generated
- **Tool call visualization** — See tool calls grouped and collapsible, with full input/output
- **Subagent nesting** — Task sub-agents render nested under their parent, with collapsed previews
- **Streaming stats** — Live elapsed time and output token count while the agent is generating
- **Permission control** — Choose permission mode (bypass, accept edits, plan, default) per session
- **Multiple sessions** — Run and switch between multiple concurrent Claude Code sessions
- **Directory browser** — Pick the working directory from a filesystem browser

<br />

---

<br />

## How It Works

The Vibe Companion uses Claude Code's hidden `--sdk-url` flag. When launched with this flag, the CLI connects back to the web server via WebSocket using an NDJSON protocol — the same protocol used internally by Claude Code's SDK transport.

```
Browser  ←→  Hono Server  ←→  Claude Code CLI
  (React)     (WebSocket)      (--sdk-url ws://...)
```

1. **Launch** — The server spawns `claude --sdk-url ws://localhost:PORT/ws/cli/SESSION_ID --print --output-format stream-json`
2. **Connect** — The CLI connects back to the server's WebSocket endpoint
3. **Bridge** — The server bridges messages between the CLI WebSocket and browser WebSocket
4. **Stream** — The browser receives real-time streaming events (text deltas, tool calls, results)

<br />

---

<br />

## Tech Stack

- **Backend:** [Bun](https://bun.sh) + [Hono](https://hono.dev) + native WebSocket
- **Frontend:** React 19 + [Zustand](https://github.com/pmndrs/zustand) + [Tailwind CSS v4](https://tailwindcss.com)
- **Build:** [Vite](https://vite.dev)

<br />

---

<br />

## License

MIT
