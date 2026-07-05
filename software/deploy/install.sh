#!/usr/bin/env bash
# Install samogrow on a Raspberry Pi: Bun, dependencies, and the systemd unit.
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

# 3. Camera / GPIO tools (best effort; ignore if already present).
if command -v apt-get >/dev/null 2>&1; then
  echo "==> installing rpicam-apps, fswebcam, gpiod (needs sudo)"
  sudo apt-get update -y || true
  sudo apt-get install -y rpicam-apps fswebcam gpiod || true
fi

# 4. Install and enable the systemd unit.
echo "==> installing systemd unit"
sudo cp deploy/samogrow.service /etc/systemd/system/samogrow.service
sudo systemctl daemon-reload
sudo systemctl enable samogrow.service

echo
echo "Done. Create /home/pi/samogrow/.env (see .env.example), then:"
echo "  sudo systemctl start samogrow"
echo "  journalctl -u samogrow -f"
