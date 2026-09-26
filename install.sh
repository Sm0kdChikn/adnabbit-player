#!/usr/bin/env bash
# AdNabbit player — Ubuntu/Debian install helper
# Preferred for mini-PC: download AppImage from GitHub Releases, or npm run dist.
# Autostart is opt-in only: --autostart / --systemd (never forced).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

INSTALL_AUTOSTART=0
INSTALL_SYSTEMD=0
NONINTERACTIVE=0

usage() {
  cat <<USAGE
Usage: ./install.sh [options]

  (default)          Install npm deps only — no autostart wiring
  --autostart        Install .desktop to ~/.local/share/applications
                     and ~/.config/autostart (opt-in)
  --systemd          Install systemd --user unit template (opt-in; not enabled)
  --yes              Non-interactive (same as defaults + honor flags above)
  -h, --help         Show this help

Packaged GUI (recommended on mini-PC):
  npm run dist                 # AppImage + .deb → dist/
  # or download AppImage from GitHub Releases
  # First launch = setup GUI (API URL + claim code)

Kiosk box (Ticket P.1.3 — dedicated user + DM autologin + XDG autostart):
  sudo ./scripts/install-autostart.sh --appimage dist/*.AppImage
  # installs AppImage under /opt/adnabbit/, reboot helper, sudoers/polkit
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --autostart) INSTALL_AUTOSTART=1; shift ;;
    --systemd) INSTALL_SYSTEMD=1; shift ;;
    --yes|-y) NONINTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 18 required. Install via nodesource or nvm, then re-run."
  exit 1
fi
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Node.js >= 18 required (found $(node -v))"
  exit 1
fi

echo "Installing dependencies (npm ci)…"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

mkdir -p "$HOME/.adnabbit-player"

NPM_BIN="$(command -v npm)"
DESKTOP_SRC="$ROOT/packaging/adnabbit-player.desktop"
SERVICE_SRC="$ROOT/packaging/adnabbit-player.service"

install_desktop() {
  local apps="$HOME/.local/share/applications"
  local auto="$HOME/.config/autostart"
  mkdir -p "$apps" "$auto"
  local rendered
  rendered="$(sed "s|@ROOT@|$ROOT|g" "$DESKTOP_SRC")"
  printf '%s\n' "$rendered" > "$apps/adnabbit-player.desktop"
  printf '%s\n' "$rendered" > "$auto/adnabbit-player.desktop"
  chmod 644 "$apps/adnabbit-player.desktop" "$auto/adnabbit-player.desktop"
  echo "Installed desktop + autostart entries:"
  echo "  $apps/adnabbit-player.desktop"
  echo "  $auto/adnabbit-player.desktop"
}

install_systemd() {
  local unit_dir="$HOME/.config/systemd/user"
  mkdir -p "$unit_dir"
  sed -e "s|@ROOT@|$ROOT|g" -e "s|@NPM@|$NPM_BIN|g" "$SERVICE_SRC" \
    > "$unit_dir/adnabbit-player.service"
  chmod 644 "$unit_dir/adnabbit-player.service"
  echo "Installed user unit (not enabled):"
  echo "  $unit_dir/adnabbit-player.service"
  echo "Enable when ready:"
  echo "  systemctl --user daemon-reload"
  echo "  systemctl --user enable --now adnabbit-player"
}

if [[ "$INSTALL_AUTOSTART" -eq 1 ]]; then
  install_desktop
elif [[ "$NONINTERACTIVE" -eq 0 ]] && [[ -t 0 ]]; then
  read -r -p "Install desktop autostart entries? [y/N] " ans || true
  if [[ "${ans:-}" =~ ^[Yy]$ ]]; then
    install_desktop
  fi
fi

if [[ "$INSTALL_SYSTEMD" -eq 1 ]]; then
  install_systemd
elif [[ "$NONINTERACTIVE" -eq 0 ]] && [[ -t 0 ]]; then
  read -r -p "Install systemd user unit (not enabled)? [y/N] " ans || true
  if [[ "${ans:-}" =~ ^[Yy]$ ]]; then
    install_systemd
  fi
fi

echo ""
echo "Done."
echo ""
echo "Preferred (mini-PC GUI):"
echo "  npm run dist                 # → dist/*.AppImage (and .deb if built)"
echo "  # First launch shows setup: API URL + claim code"
echo "  # Or download AppImage from GitHub Releases"
echo ""
echo "CLI fallback:"
echo "  export ADNNABIT_API_BASE=http://127.0.0.1:3000"
echo "  npm run claim -- --code XXXXXX"
echo "  npm start"
echo ""
echo "Escape hatch (windowed/debug):"
echo "  ADNNABIT_KIOSK=0 npm start"
echo "  # or while running: Ctrl+Shift+Alt+Q (exits kiosk chrome only)"
echo "Clear pairing: rm ~/.adnabbit-player/device-token.json"
echo ""
echo "Opt-in autostart later (dev / current user session):"
echo "  ./install.sh --autostart"
echo "  ./install.sh --systemd"
echo ""
echo "Mini-PC kiosk box (P.1.3 — requires root, dedicated user + DM autologin):"
echo "  npm run dist:appimage"
echo "  sudo ./scripts/install-autostart.sh --appimage dist/AdNabbit*.AppImage"
echo "See README.md for reboot helper (P.1.2) + polkit/sudoers notes."
