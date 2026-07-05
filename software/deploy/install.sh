#!/usr/bin/env bash
# Install samogrow on an always-on Linux machine / VM (same LAN as the garden's
# Wi-Fi plugs and cameras). Installs Bun, ffmpeg, dependencies, and — on Linux
# with systemd — the service unit. On macOS it stops after deps and points you
# at the launchd plist.
#
# Run from the software/ directory:  ./deploy/install.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# 1. Install Bun if missing.
if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then
  echo "==> installing bun"
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"

# 2. Install dependencies.
echo "==> bun install"
bun install

# 3. ffmpeg (needed for RTSP camera snapshots).
if ! command -v ffmpeg >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "==> installing ffmpeg (needs sudo)"
    sudo apt-get update -y || true
    sudo apt-get install -y ffmpeg || true
  elif command -v brew >/dev/null 2>&1; then
    echo "==> installing ffmpeg via brew"
    brew install ffmpeg || true
  else
    echo "!! ffmpeg not found and no apt/brew — install it manually for RTSP cameras"
  fi
fi

# 4. Service install (Linux + systemd only).
if [ "$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
  echo "==> installing systemd unit"
  sudo cp deploy/samogrow.service /etc/systemd/system/samogrow.service
  sudo systemctl daemon-reload
  sudo systemctl enable samogrow.service
  echo
  echo "Done. Edit /etc/systemd/system/samogrow.service paths/User to match your"
  echo "install, create the .env it points at (see .env.example), then:"
  echo "  sudo systemctl start samogrow"
  echo "  journalctl -u samogrow -f"
else
  echo
  echo "Done (deps only). On macOS use deploy/com.samogrow.plist to run at login,"
  echo "or just run it directly:"
  echo "  cp .env.example .env   # fill in secrets (Bun auto-loads .env)"
  echo "  bun run src/main.ts"
fi
