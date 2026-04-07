# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public issue.**

Instead, email **security@heyhank.dev** with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

We will respond within 48 hours and work with you to resolve the issue before any public disclosure.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Security Considerations

HeyHank is designed to be self-hosted. Keep in mind:

- **Authentication**: The server generates an auth token on first start. Keep it secret.
- **Network exposure**: By default, HeyHank binds to localhost. Use Tailscale Funnel or a reverse proxy for remote access.
- **API keys**: All API keys (Anthropic, Gemini, etc.) are stored locally in `~/.heyhank/` and never transmitted to third parties.
- **Email credentials**: Email account passwords are stored locally with restricted file permissions (0600).
