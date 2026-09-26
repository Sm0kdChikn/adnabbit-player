# AdNabbit Player (Ticket L)

Software-first Linux kiosk player for [adnabbit](https://github.com/Sm0kdChikn/adnabbit).

Pairs to a screen via a one-time claim code, heartbeats, polls the next-24h playlist, caches creatives locally, and loops video/image playback in a **fullscreen Electron kiosk**. **OptiSigns stays production PoP** — play-logs are accepted by the API as a **stub** (not persisted).

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

Autostart is **opt-in** (never forced by default):

```bash
./install.sh --autostart   # ~/.local/share/applications + ~/.config/autostart
./install.sh --systemd     # user unit template (written, not enabled)
./install.sh --yes         # non-interactive deps-only (flags still honored)
```

Interactive runs may prompt for autostart/systemd; answer N to skip.

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

## Kiosk behavior (default)

`npm start` launches Electron in **kiosk lockdown** unless escaped (see below):

| Lockdown | Behavior |
|----------|----------|
| Fullscreen kiosk | `kiosk` + frameless window |
| Menu bar | Hidden / application menu null |
| Always on top | On by default; set `ADNNABIT_ALWAYS_ON_TOP=0` to disable |
| Context menu | Disabled while kiosk chrome is active |
| DevTools | Disabled when starting in kiosk |
| Shortcuts | Blocks (where Electron allows) Alt+F4, Ctrl+W, Ctrl+Q, Ctrl+Shift+I/J/C, F12, F5, Ctrl+R |
| Cursor | Hidden after ~3s idle while playing; shown on mouse move (soft miss OK on some Linux WMs) |

Claim / playlist / cache / play-log behavior is unchanged from Ticket J.

## Escape hatch (admins)

Two ways to get **windowed/debug** mode. Neither logs out of the OS or kills the session.

1. **Env wins at start** — `ADNNABIT_KIOSK=0` always disables kiosk chrome for that launch (framed window, DevTools allowed):

   ```bash
   ADNNABIT_KIOSK=0 npm start
   ```

2. **Hotkey while running** — `Ctrl+Shift+Alt+Q` exits **Electron kiosk chrome only** (leaves fullscreen/kiosk/always-on-top). The app keeps running windowed; it does **not** quit the process or touch the OS desktop session.

## Smoke steps

```bash
# After claim (no GUI required):
npm run kiosk:headless
# → heartbeat OK, playlist items, assets cached, play-logs 202
# sample JSON: ~/.adnabbit-player/playlist-sample.json (or ./data/)

npm start                 # Electron kiosk (default)
ADNNABIT_KIOSK=0 npm start  # windowed/debug escape
```

## Env

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADNNABIT_API_BASE` | `http://127.0.0.1:3000` | Web API origin |
| `ADNNABIT_KIOSK` | on (unset) | Set `0` at start for windowed/debug — **always wins** |
| `ADNNABIT_ALWAYS_ON_TOP` | on in kiosk | Set `0` to allow other windows above |
| `ADNNABIT_FULLSCREEN` | unset | Legacy; kiosk already fullscreen. Set `1` if starting with `ADNNABIT_KIOSK=0` but still want fullscreen |

## Autostart (opt-in)

Templates live in `packaging/`:

- `adnabbit-player.desktop` — applications + autostart entry (`ADNNABIT_KIOSK=1`)
- `adnabbit-player.service` — systemd **user** unit template

```bash
./install.sh --autostart
./install.sh --systemd
# then, only if you want it running now:
systemctl --user daemon-reload
systemctl --user enable --now adnabbit-player
```

## OS-level lockdown (soft miss / later)

Electron kiosk is **not** a full OS lockdown. For a dedicated Lobby TV box, operators may later:

- Use a guest / kiosk Linux user with minimal desktop chrome
- Autologin + hide panel / dock (GNOME/KDE settings)
- Disable VT switching / screen lock as appropriate for the site

Those steps are **out of scope** for this agent/repo pass — document only; do not automate OS lockdown here.

## Out of scope

Fleet management, custom ISO, F2 play-log persistence, OptiSigns cutover, forced OS lockdown.
