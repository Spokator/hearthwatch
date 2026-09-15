# Security

Hearthwatch gives full control over a game server: treat the panel like an admin console.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting (**Security → Report a vulnerability**) on this repository. You will get an answer as soon as possible.

## Hardening checklist

- Sign in once right after installing and choose a strong owner password.
- Use HTTPS (`DOMAIN` + `docker compose --profile https up -d`) or keep the panel on a private network or VPN.
- Give friends the lowest role they need (viewer or moderator) and review the audit log.
- Keep Hearthwatch updated: `docker compose pull && docker compose up -d`.
- Never expose the RCON port (2458): it only listens inside the container.
