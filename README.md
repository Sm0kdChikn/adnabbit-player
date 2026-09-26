# AdNabbit Player

Linux Electron kiosk player for [adnabbit](https://github.com/Sm0kdChikn/adnabbit).

Pairs to a screen via a one-time claim code (GUI or CLI), heartbeats, polls the next-24h playlist, caches creatives locally, and loops video/image playback in a **fullscreen Electron kiosk**. **OptiSigns stays production PoP** — play-logs are accepted by the API as a **stub** (not persisted).

## Mini-PC (recommended)

1. **Ubuntu 24.04** (Wayland OK).
2. **Preferred:** download the **AppImage** from [GitHub Releases](https://github.com/Sm0kdChikn/adnabbit-player/releases), or build locally after clone:

   ```bash
   git clone https://github.com/Sm0kdChikn/adnabbit-player.git
   cd adnabbit-player
   npm ci
   npm run dist          # AppImage + .deb under dist/
   # or: npm run dist:appimage
   ```

3. Make the AppImage executable and open it (double-click or `./AdNabbit*.AppImage`).
4. **First launch (unpaired):** setup GUI — enter the AdNabbit **web API URL** and the **6-digit claim code** from admin / host portal → **Connect / Claim**.
5. After pairing, the player enters the normal kiosk / playlist flow. API URL and device token are saved under `~/.adnabbit-player/` (env `ADNNABIT_API_BASE` is optional once saved).

### Fallback (git + CLI)

```bash
git clone https://github.com/Sm0kdChikn/adnabbit-player.git
cd adnabbit-player
./install.sh
export ADNNABIT_API_BASE=http://127.0.0.1:3000   # or your web origin
npm run claim -- --code XXXXXX
npm start
```

Or persist URL via CLI: `npm run claim -- --code XXXXXX --api-base https://your-web.example`.

## Escape hatches (unchanged)

Neither logs out of the OS or kills the desktop session.

1. **Env at start** — `ADNNABIT_KIOSK=0` → windowed/debug (framed, DevTools allowed):

   ```bash
   ADNNABIT_KIOSK=0 npm start
   # AppImage:
   ADNNABIT_KIOSK=0 ./AdNabbit*.AppImage
   ```

2. **Hotkey while running** — `Ctrl+Shift+Alt+Q` exits **Electron kiosk chrome only** (leaves fullscreen/kiosk/always-on-top). App keeps running windowed.

### Clear pairing / re-pair

- In windowed mode (`ADNNABIT_KIOSK=0` or after the hotkey), use **Clear pairing** in the top chrome, **or**
- Delete the token file and relaunch:

  ```bash
  rm ~/.adnabbit-player/device-token.json
  ```

  Next launch shows the setup GUI again. API base in `~/.adnabbit-player/api-base.json` is kept unless you remove it too.

## Requirements

- Node.js 18+ (for clone / `npm start` / `npm run dist`)
- Linux desktop for Electron; headless API smoke: `npm run kiosk:headless`
- Reachable AdNabbit web (`ADNNABIT_API_BASE`, saved `api-base.json`, or default `http://127.0.0.1:3000`)

## Install from source (Ubuntu/Debian)

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

Packaged builds (no Node needed on the mini-PC after download):

```bash
npm run dist               # AppImage + deb → dist/
npm run dist:appimage      # AppImage only
npm run dist:dir           # unpacked dir if AppImage tooling fails
```

AppImage builds may need FUSE / `libfuse2` on some hosts (`sudo apt install libfuse2`). If `npm run dist` fails on AppImage, use `npm run dist:dir` and run `dist/linux-unpacked/adnabbit-player`.

## Kiosk behavior (default after pairing)

| Lockdown | Behavior |
|----------|----------|
| Fullscreen kiosk | `kiosk` + frameless when started paired |
| Menu bar | Hidden / application menu null |
| Always on top | On by default; set `ADNNABIT_ALWAYS_ON_TOP=0` to disable |
| Context menu | Disabled while kiosk chrome is active |
| DevTools | Disabled when starting in kiosk |
| Shortcuts | Blocks (where Electron allows) Alt+F4, Ctrl+W, Ctrl+Q, Ctrl+Shift+I/J/C, F12, F5, Ctrl+R |
| Cursor | Hidden after ~3s idle while playing; shown on mouse move |

Setup GUI is always **windowed** (not kiosk) until claim succeeds.


## Playlist refresh (Ticket O)

The web admin/host can click **Refresh playlist** on a paired screen. That bumps `Device.playlistEpoch` on the API. Each **heartbeat** (and playlist GET) returns `playlistEpoch`; if it is newer than the player's last seen value, Electron immediately calls `refreshPlaylist()` — no permanent poll-interval change. Soft miss: no WebSockets.



## Remote view / screenshot (Ticket P)

When the admin clicks **View screen**, the API bumps `screenshotEpoch`. Heartbeat returns `commands.captureScreenshot: true`; Electron captures the kiosk `BrowserWindow` via `webContents.capturePage()`, JPEG-encodes it, and `POST`s to `/api/device/screenshot` (does **not** exit kiosk).

Headless smoke agent: if the command is present, logs and **skips** capture (no BrowserWindow).

For true live OS remoting (mouse/keyboard), operators should use **Tailscale + wayvnc** (ops path B) — not built into the player.

## Smoke steps

```bash
# After claim (no GUI required):
npm run kiosk:headless
# → heartbeat OK (+ playlistEpoch, commands.captureScreenshot), playlist items, assets cached, play-logs 202

npm start                      # Electron (setup if unpaired, else kiosk)
ADNNABIT_KIOSK=0 npm start     # windowed/debug escape
```

## Env

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADNNABIT_API_BASE` / `ADNABBIT_API_BASE` | saved file → `http://127.0.0.1:3000` | Web API origin (env wins over `~/.adnabbit-player/api-base.json`) |
| `ADNNABIT_KIOSK` | on (unset) | Set `0` at start for windowed/debug — **always wins** |
| `ADNNABIT_ALWAYS_ON_TOP` | on in kiosk | Set `0` to allow other windows above |
| `ADNNABIT_FULLSCREEN` | unset | Legacy; kiosk already fullscreen |

## Autostart (opt-in)

Templates live in `packaging/`:

- `adnabbit-player.desktop` — applications + autostart entry (`ADNNABIT_KIOSK=1`)
- `adnabbit-player.service` — systemd **user** unit template

```bash
./install.sh --autostart
./install.sh --systemd
systemctl --user daemon-reload
systemctl --user enable --now adnabbit-player
```

## Data directory

`~/.adnabbit-player/` (fallback `./data/`):

| File | Purpose |
|------|---------|
| `device-token.json` | Paired device token + screen metadata |
| `api-base.json` | Persisted API origin from setup GUI / CLI |
| `playlist-cache.json` | Last playlist (offline fallback) |
| `assets/` | Cached creatives |

## OS-level lockdown (soft miss / later)

Electron kiosk is **not** a full OS lockdown. For a dedicated Lobby TV box, operators may later use a guest/kiosk user, autologin, hide panel/dock, etc. Those steps are **out of scope** here.

## Out of scope

Fleet management, custom ISO, F2 play-log persistence, OptiSigns cutover, forced OS lockdown, Stripe, in-app VNC/WebRTC (use Tailscale + wayvnc).
