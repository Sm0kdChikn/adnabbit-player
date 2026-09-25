# AdNabbit Player (Ticket J)

Software-first Linux kiosk player spike for [adnabbit](https://github.com/Sm0kdChikn/adnabbit).

Pairs to a screen via a one-time claim code, heartbeats, polls the next-24h playlist, caches creatives locally, and loops video/image playback. **OptiSigns stays production PoP** — play-logs are accepted by the API as a **stub** (not persisted).

## Requirements

- Node.js 18+
- Linux desktop (Electron). For headless API smoke: `npm run kiosk:headless`
- Local or reachable AdNabbit web (`ADNNABIT_API_BASE`, default `http://127.0.0.1:3000`)

## Install (Ubuntu/Debian)

```bash
git clone https://github.com/Sm0kdChikn/adnabbit-player.git
cd adnabbit-player
./install.sh
```

## Pair against local web

1. Start AdNabbit web (`cd adnabbit-web && npm run db:seed && npm run dev`).
2. Admin → Screens → **Lobby TV** (or host portal) → **Mint claim code**.
3. On the player:

```bash
export ADNNABIT_API_BASE=http://127.0.0.1:3000
npm run claim -- --code XXXXXX
npm start
```

Token + cache live under `~/.adnabbit-player/` (fallback `./data/`).

## Smoke steps

```bash
# After claim:
npm run kiosk:headless
# → heartbeat OK, playlist items, assets cached, play-logs 202
# sample JSON: ~/.adnabbit-player/playlist-sample.json (or ./data/)

npm start   # Electron kiosk chrome (dark charcoal + cyan)
```

Env:

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADNNABIT_API_BASE` | `http://127.0.0.1:3000` | Web API origin |
| `ADNNABIT_FULLSCREEN` | unset | Set `1` for fullscreen |

## systemd user unit (optional)

```ini
# ~/.config/systemd/user/adnabbit-player.service
[Unit]
Description=AdNabbit kiosk player
After=graphical-session.target

[Service]
Type=simple
Environment=ADNNABIT_API_BASE=http://127.0.0.1:3000
Environment=DISPLAY=:0
WorkingDirectory=/path/to/adnabbit-player
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now adnabbit-player
```

## Out of scope

Fleet management, custom ISO, F2 play-log persistence, OptiSigns cutover.
