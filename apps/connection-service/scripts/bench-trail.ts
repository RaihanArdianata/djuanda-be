/**
 * Measures what a trail request costs and what the store holds, with a busy sky:
 *   bun run apps/connection-service/scripts/bench-trail.ts [aircraft] [hours]
 * Budget: memory path p95 < 10 ms for a full trail, store under 64 MB for the default scenario (60 aircraft, 2 h).
 * Bytes per point is printed too: the configured caps (TRAIL_MAX_TRACKS x TRAIL_MAX_POINTS_PER_TRACK)
 * are an upper bound, not a budget, so size them against this number.
 */
import type { CurrentTrack } from "@aeroswarm/core/types";
import { createTrailStore, formatTrail } from "@aeroswarm/live-server";

const AIRCRAFT = Number(process.argv[2] ?? 60);
const HOURS = Number(process.argv[3] ?? 2);
const REPORT_S = 1;
const SPEED_MS = 220; // ~430 kt
const M_PER_DEG = 111_320;
const T0 = Date.UTC(2026, 10, 1, 0, 0, 0);

const print = (line: string): void => {
  process.stdout.write(`${line}
`);
};

const trail = createTrailStore({
  minDistanceM: 100,
  maxPointsPerTrack: 20_000,
});
Bun.gc(true);
const heapBefore: number = process.memoryUsage().heapUsed;

function trackAt(i: number, s: number): CurrentTrack {
  const bearing = (i * 37) % 360;
  const rad = (bearing * Math.PI) / 180;
  const d = s * SPEED_MS;
  return {
    trackId: `t${i}`,
    source: "ASTERIX_CAT021",
    icao24: i.toString(16).padStart(6, "0"),
    callsign: `BNCH${i}`,
    squawk: null,
    lat: -7.38 + (d * Math.cos(rad)) / M_PER_DEG,
    lon: 112.78 + (d * Math.sin(rad)) / (M_PER_DEG * 0.99),
    altitudeFt: 30_000,
    groundSpeedKt: 430,
    headingDeg: bearing,
    verticalRateFpm: 0,
    confidence: 1,
    lastSeenAt: T0 + s * 1000,
    status: "active",
  };
}

const total: number = HOURS * 3600;
const feedStart = performance.now();
let reports = 0;
for (let s = 0; s <= total; s += REPORT_S) {
  for (let i = 0; i < AIRCRAFT; i++) {
    trail.record(trackAt(i, s));
    reports++;
  }
}
const feedMs: number = performance.now() - feedStart;

function percentile(sorted: number[], p: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  );
}

function time(label: string, run: (i: number) => void, n = 600): void {
  const samples: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = performance.now();
    run(k);
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  print(
    `${label.padEnd(44)} p50 ${percentile(samples, 0.5).toFixed(2)} ms  p95 ${percentile(samples, 0.95).toFixed(2)} ms  p99 ${percentile(samples, 0.99).toFixed(2)} ms`,
  );
}

Bun.gc(true);
const stats = trail.stats();
const heapMb: number =
  (process.memoryUsage().heapUsed - heapBefore) / 1_048_576;
print(`${AIRCRAFT} aircraft x ${HOURS} h, ${reports} reports at ${REPORT_S}/s`);
print(
  `recording: ${((feedMs * 1000) / reports).toFixed(2)} us per report (${Math.round(reports / (feedMs / 1000))} reports/s on one core)`,
);
const bytesPerPoint: number = (heapMb * 1_048_576) / Math.max(1, stats.points);
print(
  `held: ${stats.tracks} tracks, ${stats.points} points, ~${heapMb.toFixed(1)} MB heap after GC (${bytesPerPoint.toFixed(0)} B/point)`,
);

const opts = { tz: "Asia/Jakarta", labelEveryMs: 120_000 };
time("query: whole flight, limit 5000", (k) => {
  trail.query(`t${k % AIRCRAFT}`, { limit: 5_000 });
});
time("query + GeoJSON + labels, limit 5000", (k) => {
  const slice = trail.query(`t${k % AIRCRAFT}`, { limit: 5_000 });
  if (slice) formatTrail(slice, opts);
});
time("query: last 60 s (polling)", (k) => {
  trail.query(`t${k % AIRCRAFT}`, { sinceMs: T0 + (total - 60) * 1000 });
});

const MEMORY_BUDGET_MB = 64;
const ok = heapMb < MEMORY_BUDGET_MB;
print(
  ok
    ? `memory within the ${MEMORY_BUDGET_MB} MB budget`
    : `OVER the ${MEMORY_BUDGET_MB} MB budget`,
);
if (!ok) process.exit(1);
