import type { TrailStore } from "@aeroswarm/live-server";
import { createCounter, createGauge } from "@repo/shared/metrics";

/** Counted where a request is answered (trail.route.ts). */
export const trailMetrics = {
  fromMemory: createCounter(
    "trail_requests_memory_total",
    "Trail requests answered from memory",
  ),
  fromDatabase: createCounter(
    "trail_requests_database_total",
    "Trail requests answered from the database (memory had nothing, or was joined with it)",
  ),
  notFound: createCounter(
    "trail_requests_not_found_total",
    "Trail requests for a track nobody knows",
  ),
};

let registered = false;

/** What the store holds, read when Prometheus scrapes. Call once at startup. */
export function registerTrailStatMetrics(trail: TrailStore): void {
  if (registered) return;
  registered = true;
  createGauge(
    "trail_tracks",
    "Aircraft with a trail in memory",
    function collect(): void {
      this.set(trail.stats().tracks);
    },
  );
  createGauge(
    "trail_points",
    "Trail points held in memory, all aircraft",
    function collect(): void {
      this.set(trail.stats().points);
    },
  );
}
