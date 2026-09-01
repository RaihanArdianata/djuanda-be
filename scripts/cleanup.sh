#!/usr/bin/env bash
set -euo pipefail

# Dynamic disk cleanup for Docker service logs, journald, and build cache.
# Run as root or as a user with sudo + docker group.
#
# To run manually:
#   ./scripts/cleanup.sh
#
# To schedule daily at 2 AM, run:
#   ./scripts/install-cleanup-cron.sh

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

# 1. Truncate selected container logs by service name (no hardcoded IDs)
SERVICES="connection-service client-service process-service"
LOG_DIR="/var/lib/docker/containers"

for service in $SERVICES; do
  ids=$(docker ps -aqf name="$service" 2>/dev/null || true)
  if [ -z "$ids" ]; then
    echo "No container found for '$service', skipping."
    continue
  fi

  for id in $ids; do
    full=$(docker inspect -f '{{.Id}}' "$id" 2>/dev/null || true)
    [ -z "$full" ] && continue

    log_file="$LOG_DIR/$full/$full-json.log"
    if [ -f "$log_file" ]; then
      $SUDO sh -c ": > \"$log_file\""
      echo "Truncated $log_file ($service)"
    else
      echo "Log file not found: $log_file ($service)"
    fi
  done
done

# 2. Vacuum journal logs
echo "Vacuuming journal logs to 100MB..."
$SUDO journalctl --vacuum-size=100M

# 3. Prune Docker build cache
echo "Pruning Docker build cache..."
docker builder prune -f

# 4. Show results
echo "Disk usage after cleanup:"
$SUDO df -h
