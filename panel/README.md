# Hearthwatch panel

Fastify API (`server/`) and React + Vite + Tailwind interface (`web/`).

## Development

```bash
npm install
npm run dev      # interface on http://localhost:5173, /api proxied to 127.0.0.1:4030
npm run build    # production build into dist/
```

To work against a real server, forward the panel port first, for example `ssh -L 4030:127.0.0.1:4030 user@server`.

## Runtime modes

`server/runtime.js` reads the environment:

| Variable | Docker image | Native install |
| --- | --- | --- |
| `HW_MODE` | `docker`: controls Valheim with `supervisorctl`, reads `/data/logs/valheim.log` | unset (`systemd`): `systemctl` / `journalctl` through sudo |
| `HW_DATA_DIR` | `/data` | `/opt/valheim` |
| `HW_HOST` / `HW_PORT` | `0.0.0.0` / `8080` | `127.0.0.1` / `PANEL_PORT` from `panel.env` (4030) |
| `HW_TRUST_PROXY` | `true` | `127.0.0.1` |
| `PUBLIC_ADDRESS` | from `.env` | optional |

Data directory layout (identical in both modes):

| Path | Content |
| --- | --- |
| `valheim.env` | Game launch settings, edited by the panel |
| `panel.env` | RCON port and password |
| `panel-users.json`, `panel-audit.log`, `panel-gm.json` | Panel accounts, audit log, game master state |
| `server/` | Valheim, BepInEx, plugins and their configs |
| `data/` | Worlds, admin / ban / permit lists, `panelmap/` exports |
| `backups/` | World archives |

## Native install (advanced)

Docker is the supported path. The `deploy/` folder contains what a systemd setup needs:

- `valheim-panel.service`: the panel, running as the `valheim` user
- `sudoers-valheim-panel`: lets the panel start / stop / restart `valheim.service` and read its journal, nothing else (arguments must match `server/system.js`)
- `deploy.sh`: builds and uploads the panel over SSH (`HOST=user@server bash panel/deploy/deploy.sh`)

You also need a `valheim.service` that sources `valheim.env` the same way as `docker/scripts/start-valheim.sh`, BepInEx, ValheimRcon (RCON on 127.0.0.1) and the HearthwatchBridge plugin.

## Security model

- Every `/api` route declares a permission; the server refuses to start otherwise.
- Sessions are HttpOnly, SameSite=strict cookies; mutating requests require the `X-Panel` header.
- Passwords are hashed with scrypt; new and reset accounts must choose their own password.
- RCON only listens on localhost; the RCON and BepInEx configs are hidden from the mod editor.
