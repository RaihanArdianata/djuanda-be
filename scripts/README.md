# Utility Scripts

## `cleanup.sh`

Dynamic disk cleanup for Docker container logs, journald, and Docker build cache.

### Run manually

```bash
./scripts/cleanup.sh
```

What it does:

1. Finds containers named `connection-service`, `client-service`, and `process-service`.
2. Truncates their `/var/lib/docker/containers/<id>/<id>-json.log` files.
3. Vacuums journald logs down to 100 MB.
4. Prunes the Docker build cache.
5. Prints `df -h` output.

Run as root or as a user with `sudo` and Docker access.

## `install-cleanup-cron.sh`

Installs a daily cron job that runs `cleanup.sh` at 02:00.

### Install

```bash
./scripts/install-cleanup-cron.sh
```

Example output:

```
Installing daily cron job for: /home/mid/apps/backend-djuanda/scripts/cleanup.sh
Done. The cleanup will run every day at 02:00.
```

### Stop / remove the cron job

Edit the cron table as the same user (usually root):

```bash
sudo crontab -e
```

Delete the line containing `scripts/cleanup.sh`, then save and exit.

Or remove it with one command:

```bash
(sudo crontab -l | grep -v 'scripts/cleanup.sh') | sudo crontab -
```
