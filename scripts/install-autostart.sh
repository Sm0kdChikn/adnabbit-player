#!/usr/bin/env bash
# AdNabbit P.1.3 — mini-PC kiosk box install (Ubuntu 24.04 Wayland-friendly)
#
# Dedicated user + display-manager autologin + XDG autostart of the AppImage.
# Linger alone is NOT enough for a graphical session — we configure the DM.
#
# Usage (as root on the mini-PC):
#   sudo ./scripts/install-autostart.sh --appimage /path/to/AdNabbit-Player.AppImage
#   sudo ./scripts/install-autostart.sh --appimage … --user adnabbit --yes
#
# Also installs the P.1.2 adnabbit-reboot helper + sudoers NOPASSWD (+ optional polkit).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KIOSK_USER="adnabbit"
APPIMAGE_SRC=""
OPT_DIR="/opt/adnabbit"
INSTALL_REBOOT=1
INSTALL_POLKIT=1
NONINTERACTIVE=0
SKIP_DM=0

usage() {
  cat <<USAGE
Usage: sudo $0 --appimage /path/to/AdNabbit-Player.AppImage [options]

  --appimage PATH   AppImage to install under ${OPT_DIR}/ (required)
  --user NAME       Dedicated kiosk username (default: adnabbit)
  --opt DIR         Install prefix (default: /opt/adnabbit)
  --no-reboot       Skip adnabbit-reboot helper / sudoers
  --no-polkit       Skip polkit rule (sudoers still installed unless --no-reboot)
  --skip-dm         Skip display-manager autologin (XDG autostart only)
  --yes             Non-interactive
  -h, --help        Show help

What this does:
  1. Creates kiosk user (if missing) with a home directory
  2. Copies AppImage + logo to ${OPT_DIR}/
  3. Writes XDG autostart desktop entry for that user
  4. Configures GDM or LightDM automatic login (when detected)
  5. Enables systemd lingering for the user (session helpers)
  6. Installs /usr/local/sbin/adnabbit-reboot + sudoers NOPASSWD (+ polkit)

After reboot the box should land in the kiosk user session and launch the
player. Unpaired → setup/claim GUI. Paired → kiosk playback (P.1.1 preference).
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --appimage) APPIMAGE_SRC="$2"; shift 2 ;;
    --user) KIOSK_USER="$2"; shift 2 ;;
    --opt) OPT_DIR="$2"; shift 2 ;;
    --no-reboot) INSTALL_REBOOT=0; shift ;;
    --no-polkit) INSTALL_POLKIT=0; shift ;;
    --skip-dm) SKIP_DM=1; shift ;;
    --yes|-y) NONINTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0 …" >&2
  exit 1
fi

if [[ -z "$APPIMAGE_SRC" ]]; then
  echo "--appimage PATH is required" >&2
  usage
  exit 1
fi
if [[ ! -f "$APPIMAGE_SRC" ]]; then
  echo "AppImage not found: $APPIMAGE_SRC" >&2
  exit 1
fi

echo "==> Kiosk user: $KIOSK_USER"
if ! id -u "$KIOSK_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --comment "AdNabbit kiosk" "$KIOSK_USER"
  echo "    created user $KIOSK_USER"
else
  echo "    user exists"
fi
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
KIOSK_UID="$(id -u "$KIOSK_USER")"
KIOSK_GID="$(id -g "$KIOSK_USER")"

echo "==> Install AppImage → $OPT_DIR"
mkdir -p "$OPT_DIR"
install -m 755 "$APPIMAGE_SRC" "$OPT_DIR/AdNabbit-Player.AppImage"
if [[ -f "$ROOT/packaging/logo.jpg" ]]; then
  install -m 644 "$ROOT/packaging/logo.jpg" "$OPT_DIR/logo.jpg"
fi
# Desktop entry for applications menu + template for autostart
DESKTOP_DST="$OPT_DIR/adnabbit-player.desktop"
sed "s|/opt/adnabbit|$OPT_DIR|g" "$ROOT/packaging/adnabbit-player-appimage.desktop" \
  > "$DESKTOP_DST"
chmod 644 "$DESKTOP_DST"
chown -R root:root "$OPT_DIR"

echo "==> XDG autostart for $KIOSK_USER"
AUTO_DIR="$KIOSK_HOME/.config/autostart"
APPS_DIR="$KIOSK_HOME/.local/share/applications"
mkdir -p "$AUTO_DIR" "$APPS_DIR"
install -m 644 -o "$KIOSK_UID" -g "$KIOSK_GID" "$DESKTOP_DST" \
  "$AUTO_DIR/adnabbit-player.desktop"
install -m 644 -o "$KIOSK_UID" -g "$KIOSK_GID" "$DESKTOP_DST" \
  "$APPS_DIR/adnabbit-player.desktop"
mkdir -p "$KIOSK_HOME/.adnabbit-player"
chown -R "$KIOSK_UID:$KIOSK_GID" "$KIOSK_HOME/.config" "$KIOSK_HOME/.local" \
  "$KIOSK_HOME/.adnabbit-player"

echo "==> systemd lingering for $KIOSK_USER"
if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$KIOSK_USER" || true
fi

if [[ "$SKIP_DM" -eq 0 ]]; then
  echo "==> Display manager autologin"
  if [[ -d /etc/gdm3 ]] || [[ -d /etc/gdm ]]; then
    GDM_CONF=""
    if [[ -f /etc/gdm3/custom.conf ]]; then
      GDM_CONF=/etc/gdm3/custom.conf
    elif [[ -f /etc/gdm/custom.conf ]]; then
      GDM_CONF=/etc/gdm/custom.conf
    else
      GDM_CONF=/etc/gdm3/custom.conf
      mkdir -p "$(dirname "$GDM_CONF")"
      cp "$ROOT/packaging/gdm/custom.conf" "$GDM_CONF"
    fi
    # Ensure AutomaticLogin* lines for our user (idempotent-ish)
    if grep -q '^\[daemon\]' "$GDM_CONF" 2>/dev/null; then
      sed -i \
        -e "s/^#\\?AutomaticLoginEnable=.*/AutomaticLoginEnable=True/" \
        -e "s/^#\\?AutomaticLogin=.*/AutomaticLogin=${KIOSK_USER}/" \
        "$GDM_CONF" || true
      if ! grep -q '^AutomaticLoginEnable=' "$GDM_CONF"; then
        sed -i "/^\[daemon\]/a AutomaticLoginEnable=True\nAutomaticLogin=${KIOSK_USER}" "$GDM_CONF"
      fi
      if ! grep -q '^AutomaticLogin=' "$GDM_CONF"; then
        sed -i "/^\[daemon\]/a AutomaticLogin=${KIOSK_USER}" "$GDM_CONF"
      fi
    else
      printf '\n[daemon]\nAutomaticLoginEnable=True\nAutomaticLogin=%s\n' "$KIOSK_USER" >> "$GDM_CONF"
    fi
    # Rewrite AutomaticLogin to exact user
    sed -i "s/^AutomaticLogin=.*/AutomaticLogin=${KIOSK_USER}/" "$GDM_CONF"
    sed -i "s/^AutomaticLoginEnable=.*/AutomaticLoginEnable=True/" "$GDM_CONF"
    echo "    configured GDM: $GDM_CONF"
  elif [[ -d /etc/lightdm ]]; then
    mkdir -p /etc/lightdm/lightdm.conf.d
    sed "s/adnabbit/${KIOSK_USER}/g" \
      "$ROOT/packaging/lightdm/50-adnabbit-autologin.conf" \
      > /etc/lightdm/lightdm.conf.d/50-adnabbit-autologin.conf
    echo "    configured LightDM autologin"
  else
    echo "    WARN: no GDM/LightDM detected — configure DM autologin manually"
    echo "    XDG autostart is installed; session must start without interactive login"
  fi
else
  echo "==> Skipping DM autologin (--skip-dm)"
fi

if [[ "$INSTALL_REBOOT" -eq 1 ]]; then
  echo "==> P.1.2 reboot helper"
  install -m 755 "$ROOT/packaging/adnabbit-reboot" /usr/local/sbin/adnabbit-reboot
  # sudoers — substitute username
  TMP_SUDOERS="$(mktemp)"
  sed "s/^adnabbit /${KIOSK_USER} /" "$ROOT/packaging/sudoers.d/adnabbit-reboot" > "$TMP_SUDOERS"
  if command -v visudo >/dev/null 2>&1; then
    if visudo -cf "$TMP_SUDOERS"; then
      install -m 440 "$TMP_SUDOERS" /etc/sudoers.d/adnabbit-reboot
      echo "    sudoers: /etc/sudoers.d/adnabbit-reboot"
    else
      echo "    ERROR: sudoers validation failed; not installing" >&2
      rm -f "$TMP_SUDOERS"
      exit 1
    fi
  else
    install -m 440 "$TMP_SUDOERS" /etc/sudoers.d/adnabbit-reboot
  fi
  rm -f "$TMP_SUDOERS"

  if [[ "$INSTALL_POLKIT" -eq 1 ]] && [[ -d /etc/polkit-1/rules.d ]]; then
    sed "s/adnabbit/${KIOSK_USER}/g" \
      "$ROOT/packaging/polkit/10-adnabbit-reboot.rules" \
      > /etc/polkit-1/rules.d/10-adnabbit-reboot.rules
    chmod 644 /etc/polkit-1/rules.d/10-adnabbit-reboot.rules
    echo "    polkit: /etc/polkit-1/rules.d/10-adnabbit-reboot.rules"
  fi
fi

echo ""
echo "Done. Next steps:"
echo "  1. First boot: player opens setup (API URL + claim code) if unpaired"
echo "  2. After claim: kiosk playback; preference persists (P.1.1)"
echo "  3. Admin Remote view → Reboot device exercises adnabbit-reboot"
echo "  4. Reboot now to verify autologin + autostart:"
echo "       systemctl reboot"
echo ""
echo "Escape hatch on the box:"
echo "  ADNNABIT_KIOSK=0 $OPT_DIR/AdNabbit-Player.AppImage"
echo "  # or Ctrl+Shift+Alt+Q to unlock Electron kiosk chrome"
