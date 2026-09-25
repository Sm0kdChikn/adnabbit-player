#!/usr/bin/env bash
# AdNabbit player — Ubuntu/Debian install helper (Ticket J spike)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

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

echo ""
echo "Done. Pair then start:"
echo "  export ADNNABIT_API_BASE=http://127.0.0.1:3000"
echo "  npm run claim -- --code XXXXXX"
echo "  npm start"
echo ""
echo "Optional desktop entry (user):"
echo "  ~/.local/share/applications/adnabbit-player.desktop"
echo "Optional systemd user unit:"
echo "  ~/.config/systemd/user/adnabbit-player.service"
echo "  ExecStart=$(command -v npm) --prefix $ROOT start"
echo "See README.md for details."
