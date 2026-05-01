# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in HeyHank, please report it
**privately**. Do not open a public issue or pull request describing it.

**Preferred channel — GitHub Private Vulnerability Reporting:**

1. Go to <https://github.com/heyhank-app/heyhank/security/advisories/new>
2. Fill in the form (title, description, affected versions, repro steps)
3. Submit — only HeyHank maintainers will see it

**Alternative — email:** `security@heyhank.app`

Please include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact (data exposure, RCE, auth bypass, etc.)
- Affected version(s)

We aim to acknowledge reports within 72 hours and to ship a fix or
mitigation within 14 days for high-impact issues. We will coordinate a
public disclosure with you once a fix is available.

## Supported Versions

HeyHank is currently in active development. Only the latest published
version on npm is supported with security updates.

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| Older   | No        |

## Security Considerations for Self-Hosters

HeyHank is designed to be self-hosted on a machine you control. A few
things to keep in mind when operating it:

- **Authentication.** The server generates an auth token on first start
  (`~/.heyhank/auth.json`). Keep it private. Rotate it with
  `bun run generate-token --force` if leaked.
- **Network exposure.** By default the server binds to `localhost`.
  For remote access prefer Tailscale Funnel, a reverse proxy with TLS,
  or a VPN — never expose port `3456` directly to the public internet.
- **API keys.** Anthropic, Gemini and other provider keys are stored
  locally under `~/.heyhank/`. They are never sent to any HeyHank-operated
  service.
- **Email & telephony credentials.** IMAP/SMTP and SIP secrets are
  stored locally with restricted file permissions (`0600`).
- **Skills and MCP servers.** Skills installed through the Skill
  Marketplace and configured MCP servers run inside Claude Code with
  the permissions of the user that started HeyHank. Only install skills
  and MCP servers you trust.
