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

## `compare-live.ts`

Membandingkan dua stream live (`/ws/tracks/live`) berdampingan, misalnya AeroSwarm (A) dengan
connection-service baru (B), untuk jalan paralel sebelum cutover (task 11).

```bash
bun scripts/compare-live.ts   --a https://asmgcs.midigi.id/aeroswarm --a-token <token AeroSwarm>   --b https://asmgcs.midigi.id           --b-token <salah satu CONNECTION_API_TOKENS>   --airport WARR --duration 3600 --interval 5
```

Pesawat dicocokkan lewat `icao24` (lalu callsign), bukan `trackId`, karena id berbeda antar sistem.
Dilaporkan: rata-rata jumlah track, persentase pesawat yang hanya ada di satu sisi (beserta yang
paling sering), selisih posisi (p50/p95/max, hanya bila laporan keduanya berselang kurang dari 5 dtk),
ketidakcocokan `status` dan `flightPlan.phase`. Ambang bawaan: hanya-satu-sisi ≤ 5%, posisi p95 ≤ 100 m,
status ≤ 5%, phase ≤ 2%. Exit code 0 = semua lolos, 1 = ada yang gagal, 2 = argumen salah. Token juga
bisa lewat `COMPARE_A_TOKEN` / `COMPARE_B_TOKEN`. Tes: `bun test scripts/lib`.

