# Contributing to HeyHank

Thanks for your interest in contributing! HeyHank is a self-hosted web UI
for running Claude Code agents (with optional Codex support). All new
features should target Claude Code first; Codex compatibility is best-effort.

## Getting Started

1. Fork the repo
2. Clone your fork
3. Install dependencies: `cd web && bun install`
4. Start dev server: `bun run dev`
5. Run checks: `bun run typecheck && bun run test`

## Development

- **Backend**: `web/server/` — Hono + Bun (TypeScript)
- **Frontend**: `web/src/` — React 19 + Tailwind CSS
- **CLI**: `web/bin/cli.ts` — Entry point for `bunx heyhank`

See `CLAUDE.md` for detailed architecture documentation.

## Pull Requests

- Create a feature branch from `main`
- Use conventional commit style: `feat(scope): description`, `fix(scope): description`
- Include tests for new backend and frontend code
- Run `bun run typecheck && bun run test` before submitting
- Keep PRs focused — one feature or fix per PR

## Reporting Issues

Open an issue at https://github.com/heyhank-app/heyhank/issues with:
- Steps to reproduce
- Expected vs actual behavior
- OS, Bun version, browser

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
