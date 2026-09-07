#!/usr/bin/env bash
set -euo pipefail

# Installs a daily cron job that runs scripts/cleanup.sh at 2 AM.
# Run as root or as a user with sudo.

SCRIPT_PATH="$(realpath "${1:-./scripts/cleanup.sh}")"

echo "Installing daily cron job for: $SCRIPT_PATH"

if [ "$(id -u)" -eq 0 ]; then
  (crontab -l 2>/dev/null || true; echo "0 2 * * * $SCRIPT_PATH") | crontab -
else
  (sudo crontab -l 2>/dev/null || true; echo "0 2 * * * $SCRIPT_PATH") | sudo crontab -
fi

echo "Done. The cleanup will run every day at 02:00."
