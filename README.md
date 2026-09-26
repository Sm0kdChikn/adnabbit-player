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

## Remote control (Ticket P.1) + kiosk toggle (P.1.1)

Admin queues mouse/keyboard events on the web API. The player polls `POST /api/device/input` every ~2s (and when heartbeat reports `commands.inputPending`), then applies events with Electron `webContents.sendInputEvent` to the kiosk window.

Named commands:

| Command | Effect |
|---------|--------|
| `setKiosk` + `enabled: true/false` | Lock / unlock Electron kiosk chrome |
| `enableKiosk` / `disableKiosk` | Same as setKiosk true / false |
| `exitKiosk` | Alias for unlock (kept for P.1 compatibility) |
| `reboot` | Clean quit → `adnabbit-reboot` helper → `systemctl reboot` (Ticket P.1.2) |
| `restartApp` | Relaunch Electron process only (no OS reboot) |

Unlock → windowed (not always-on-top) so you can use the desktop around the player; lock → restore kiosk + fullscreen. Preference saved to `~/.adnabbit-player/preferences.json`. `ADNNABIT_KIOSK=0` still wins at start.

Headless smoke agent drains and **logs** events (cannot apply without BrowserWindow). Reboot/restartApp are dry-run logged in headless.

For full **OS** remoting outside Electron, operators should still use **Tailscale + wayvnc** (ops path B).

## Device reboot (Ticket P.1.2)

Admin **Reboot device** (confirm dialog) queues `{ type: "command", name: "reboot" }`. The player:

1. Stops heartbeat / playlist / input loops
2. Schedules a clean Electron quit (~600ms)
3. Spawns `sudo -n /usr/local/sbin/adnabbit-reboot` (or the helper path directly)
4. Helper runs `systemctl reboot` (falls back to `reboot`)

**Privilege:** the kiosk user must be allowed to run the helper without a password:

| Path | File |
|------|------|
| Helper | `packaging/adnabbit-reboot` → `/usr/local/sbin/adnabbit-reboot` |
| sudoers | `packaging/sudoers.d/adnabbit-reboot` → `/etc/sudoers.d/adnabbit-reboot` |
| polkit (optional) | `packaging/polkit/10-adnabbit-reboot.rules` |

Both are installed by `scripts/install-autostart.sh`. Without them the player logs an error and does **not** reboot.

Smoke-safe dry run (no OS reboot):

```bash
ADNNABIT_REBOOT_DRY_RUN=1   # player logs + quits instead of invoking helper
ADNNABIT_REBOOT_DRY_RUN=1 /usr/local/sbin/adnabbit-reboot   # helper itself no-ops
```

## Mini-PC autostart (Ticket P.1.3)

Dedicated **kiosk user** + **display-manager autologin** + **XDG autostart** of the AppImage under `/opt/adnabbit/`. Linger alone is not enough for a graphical session.

```bash
# On a build machine:
npm run dist:appimage

# On the mini-PC (Ubuntu 24.04):
sudo ./scripts/install-autostart.sh --appimage ./AdNabbit-Player-*.AppImage
# options: --user adnabbit --opt /opt/adnabbit --yes
```

What the script does:

1. Creates user `adnabbit` (if missing)
2. Installs AppImage + logo to `/opt/adnabbit/`
3. Writes XDG autostart (`~/.config/autostart/adnabbit-player.desktop`)
4. Configures GDM or LightDM automatic login
5. Enables `loginctl enable-linger` for the user
6. Installs `adnabbit-reboot` + sudoers NOPASSWD (+ polkit)

Boot flow: power-on → DM autologin as `adnabbit` → XDG starts AppImage → **Electron branded splash** (circular cyan rabbit logo) → unpaired **setup/claim** GUI, or paired **kiosk playback** (P.1.1 preference persists).

No Plymouth theme / custom ISO in this ticket.

Dev-session opt-in (current user only, no dedicated account):

```bash
./install.sh --autostart   # ~/.config/autostart
./install.sh --systemd     # user unit template
```

## Smoke steps

```bash
# After claim (no GUI required):
npm run kiosk:headless
# → heartbeat OK (+ playlistEpoch, commands.captureScreenshot/inputPending), input poll, playlist items, assets cached, play-logs 202

npm start                      # Electron (setup if unpaired, else kiosk)
ADNNABIT_KIOSK=0 npm start     # windowed/debug escape
```

## Env

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADNNABIT_API_BASE` / `ADNABBIT_API_BASE` | saved file → `http://127.0.0.1:3000` | Web API origin (env wins over `~/.adnabbit-player/api-base.json`) |
| `ADNNABIT_KIOSK` | on (unset) | Set `0` at start for windowed/debug — **always wins** over `preferences.json` |
| `ADNNABIT_ALWAYS_ON_TOP` | on in kiosk | Set `0` to allow other windows above |
| `ADNNABIT_FULLSCREEN` | unset | Legacy; kiosk already fullscreen |
| `ADNNABIT_REBOOT_DRY_RUN` | unset | Set `1` to log reboot path without OS reboot (smoke) |
| `ADNNABIT_REBOOT_HELPER` | auto | Override path to `adnabbit-reboot` helper |

## Autostart (opt-in for current user)

For a **Lobby TV mini-PC**, prefer Ticket P.1.3 (`scripts/install-autostart.sh`) above.

Dev / same-user templates in `packaging/`:

- `adnabbit-player.desktop` — applications + autostart entry (`ADNNABIT_KIOSK=1`)
- `adnabbit-player.service` — systemd **user** unit template
- `adnabbit-player-appimage.desktop` — `/opt/adnabbit` AppImage entry used by P.1.3

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
| `preferences.json` | Kiosk lock preference (P.1.1) |
| `assets/` | Cached creatives |

## OS-level lockdown

Ticket **P.1.3** covers dedicated user + DM autologin + XDG AppImage autostart. Electron kiosk (P.1.1) is still not a full desktop lockdown (panel/dock hide, etc. remain operator-optional).

## Out of scope

Fleet management, custom ISO / Plymouth theme, F2 play-log persistence, OptiSigns cutover, Stripe, in-app VNC/WebRTC (use Tailscale + wayvnc).

## Ticket Q — Soft blackout / PoP mute

Playlist, heartbeat, and claim responses include an `hours` object (`timezone`, `weekly`, `isOpenNow`, `forceLiveUntil`, `nextOpenAt` / `nextCloseAt`). The renderer re-checks every **60s** and on each playlist tick:

- **Outside hours** → black stage (`#blackout`), media stopped, `playbackState: BLACKOUT` on heartbeat.
- **PoP** (`player:play-log`) is skipped in main when closed / blackout.
- Hours are cached with the playlist so a briefly offline player still enforces blackout.

Hard display-off (CEC/DPMS) is not implemented.

## Ticket R — Fleet heartbeat fields

Heartbeat POST body may include:

- `playerVersion` — from `package.json` (always sent by Electron + headless agent)
- `diskFreeBytes` / `diskTotalBytes` — optional; not reported yet (server soft-miss / TODO)

Admin fleet board uses these for version display; disk pressure only when values are present.

## Ticket U — Download / quiet hours

Heartbeat and playlist include `downloadAllowed` + `downloadHours` (host TZ weekly window; empty = allow anytime).

- When `downloadAllowed` is false: playlist metadata still refreshes; **new** asset fetches are deferred. Existing cache hits still play.
- Status / logs: `Quiet hours — deferred N download(s)` / `download quiet hours — deferring prefetch…`
- Soft miss: force single fetch on hard cache miss (prefer defer + stale/empty).
