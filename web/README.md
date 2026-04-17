# HeyHank

Self-hosted web UI for running Claude Code and Codex agents. Multi-session management with streaming, tool call visibility, and permission control.

## Install

```bash
bunx heyhank
```

Requires [Bun](https://bun.sh) v1.0+.

## Usage

```bash
# Start the server
heyhank serve

# Install as background service
heyhank install

# Check status
heyhank status
```

## Features

- **Multi-Session Chat** — Run multiple Claude Code / Codex sessions simultaneously
- **Gemini Live Voice Assistant** — Hands-free voice control with tool calling
- **Scheduled Agents** — Cron-based agent automation
- **Media Generation** — Image (Imagen 4) and video (Veo 3.1) generation
- **Social Media** — Multi-backend posting (Postiz, Buffer)
- **Telephony** — Voice calls via FreeSWITCH SIP integration
- **Federation** — Connect multiple HeyHank instances across machines
- **Tailscale Funnel** — Public HTTPS access without port forwarding
- **PWA** — Installable on mobile and desktop

## License

MIT
