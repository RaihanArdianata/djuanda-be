import type { CurrentTrack } from "@aeroswarm/core/types";
import {
  createTrailStore,
  type TrailPoint,
  type TrailQuery,
  type TrailSlice,
  type TrailStore,
} from "@aeroswarm/live-server";
import type {
  TrackHistoryPoint,
  TrackTrailQuery,
} from "@aeroswarm/replay-server";
import { logger } from "@repo/logger";

/** What the service needs from the database (the Postgres replay store has it). */
export interface TrailHistory {
  trackTrail?(query: TrackTrailQuery): Promise<TrackHistoryPoint[]>;
}

export interface TrailServiceOptions {
  /** The live trails, kept in memory. */
  trail: TrailStore;
  /** For what memory does not hold. Absent = memory only. */
  history?: TrailHistory;
  /** Mode-S address of a track that is in the live picture: it survives a restart, a track id does not. */
  icao24Of?: (trackId: string) => string | undefined;
  /** Spacing of the points stored in memory, metres: the finest a rebuilt trail is cut to. */
  minDistanceM: number;
  /** How far back to look for the part before a restart. 0 = do not. */
  backfillMs: number;
  /** When this process started (ms). */
  startedAt: number;
  /** A slow database must not make a trail that memory could answer wait. Default 3000. */
  dbTimeoutMs?: number;
}

export type TrailSource = "memory" | "database" | "memory+database";

export interface TrailAnswer {
  slice: TrailSlice;
  source: TrailSource;
}

export interface TrailService {
  /** Undefined when nothing is known about the track. */
  get(trackId: string, query: TrailQuery): Promise<TrailAnswer | undefined>;
}

/** A track whose trail began this soon after the process started was probably in the air before. */
const RESTART_WINDOW_MS = 60_000;
const DB_BUCKET_MS = 1_000;
const DB_MAX_POINTS = 20_000;
const BACKFILL_CACHE_MAX = 500;

function toPoints(rows: TrackHistoryPoint[]): TrailPoint[] {
  const out: TrailPoint[] = [];
  for (const r of rows) {
    if (r.lat === null || r.lon === null) continue;
    out.push({
      t: r.t,
      lat: r.lat,
      lon: r.lon,
      altFt: r.altFt,
      speedKt: r.speedKt,
      headingDeg: r.headingDeg,
    });
  }
  return out;
}

/** The minimum a TrailStore needs to record a position. */
function asTrack(trackId: string, p: TrailPoint): CurrentTrack {
  return {
    trackId,
    source: "ASTERIX_CAT021",
    icao24: null,
    callsign: null,
    squawk: null,
    lat: p.lat,
    lon: p.lon,
    altitudeFt: p.altFt,
    groundSpeedKt: p.speedKt,
    headingDeg: p.headingDeg,
    verticalRateFpm: null,
    confidence: 1,
    lastSeenAt: p.t,
    status: "active",
  };
}

/** Points in time order, one per instant. */
function inOrder(points: TrailPoint[]): TrailPoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  return sorted.filter(
    (p, i) => i === 0 || p.t !== (sorted[i - 1] as TrailPoint).t,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database did not answer in ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createTrailService(opts: TrailServiceOptions): TrailService {
  const dbTimeoutMs = opts.dbTimeoutMs ?? 3_000;
  /** The part before a restart, fetched once per track and kept. */
  const backfilled = new Map<string, TrailPoint[]>();

  /** Spacing, `limit` and the rest of the query applied to points that did not come from memory. */
  function assemble(
    trackId: string,
    points: TrailPoint[],
    q: TrailQuery,
  ): TrailSlice | undefined {
    const ordered = inOrder(points);
    if (ordered.length === 0) return undefined;
    const store = createTrailStore({
      minDistanceM: Math.max(opts.minDistanceM, q.stepM ?? 0),
      maxPointsPerTrack: ordered.length + 4, // never thin by halving here: the query below does the cutting
    });
    for (const p of ordered) store.record(asTrack(trackId, p));
    return store.query(trackId, { limit: q.limit });
  }

  async function fromDatabase(query: TrackTrailQuery): Promise<TrailPoint[]> {
    if (!opts.history?.trackTrail) return [];
    const rows = await withTimeout(
      opts.history.trackTrail({
        bucketMs: DB_BUCKET_MS,
        limit: DB_MAX_POINTS,
        ...query,
      }),
      dbTimeoutMs,
    );
    return toPoints(rows);
  }

  /** Memory holds nothing for this track (removed long ago, or this process is new). */
  async function databaseOnly(
    trackId: string,
    q: TrailQuery,
  ): Promise<TrailAnswer | undefined> {
    if (!opts.history?.trackTrail) return undefined;
    const fromMs = q.sinceMs !== undefined ? q.sinceMs + 1 : q.fromMs;
    try {
      const points = await fromDatabase({ trackId, fromMs, toMs: q.toMs });
      const slice = assemble(trackId, points, q);
      if (!slice) return undefined;
      return {
        slice: {
          ...slice,
          fromStart: q.fromMs === undefined && q.sinceMs === undefined,
        },
        source: "database",
      };
    } catch (err) {
      logger.warn({ err, trackId }, "trail: database fallback failed");
      return undefined;
    }
  }

  /** Where memory's trail begins, when the request includes that beginning. */
  const memoryStart = (slice: TrailSlice): number | undefined =>
    slice.fromStart ? slice.points[0]?.t : undefined;

  function remember(trackId: string, points: TrailPoint[]): void {
    if (backfilled.size >= BACKFILL_CACHE_MAX) {
      const oldest = backfilled.keys().next();
      if (!oldest.done) backfilled.delete(oldest.value);
    }
    backfilled.set(trackId, points);
  }

  /** Why the part before memory's start is wanted, if it is. */
  function earlierReason(
    q: TrailQuery,
    firstT: number,
  ): "asked" | "restart" | null {
    if (q.fromMs !== undefined) return q.fromMs < firstT ? "asked" : null;
    const restarted =
      opts.backfillMs > 0 && firstT - opts.startedAt < RESTART_WINDOW_MS;
    return restarted ? "restart" : null;
  }

  /** The earlier part of this flight in the database, or [] when none is wanted or found. */
  async function earlierPart(
    trackId: string,
    q: TrailQuery,
    firstT: number,
  ): Promise<TrailPoint[]> {
    const reason = earlierReason(q, firstT);
    if (!reason) return [];
    // Memory's trail began when this process first saw the track, so what came before is in the
    // database under an older track id: find it by Mode-S address (by track id when there is none).
    const icao24 = opts.icao24Of?.(trackId);
    if (reason === "restart" && !icao24) return [];
    const who = icao24 ? { icao24 } : { trackId };

    if (reason === "asked") {
      return fromDatabase({
        ...who,
        fromMs: q.fromMs as number,
        toMs: firstT - 1,
      });
    }
    const cached = backfilled.get(trackId);
    if (cached) return cached;
    const points = await fromDatabase({
      ...who,
      fromMs: firstT - opts.backfillMs,
      toMs: firstT - 1,
    });
    remember(trackId, points);
    return points;
  }

  return {
    async get(
      trackId: string,
      q: TrailQuery,
    ): Promise<TrailAnswer | undefined> {
      const slice = opts.trail.query(trackId, q);
      if (!slice) return databaseOnly(trackId, q);

      const firstT = q.sinceMs === undefined ? memoryStart(slice) : undefined;
      if (firstT === undefined) return { slice, source: "memory" };

      let older: TrailPoint[] = [];
      try {
        older = await earlierPart(trackId, q, firstT);
      } catch (err) {
        // Memory can still answer: serve what it has rather than nothing.
        logger.warn(
          { err, trackId },
          "trail: could not read the earlier part from the database",
        );
      }
      if (older.length === 0) return { slice, source: "memory" };

      const raw =
        opts.trail.query(trackId, { fromMs: q.fromMs, toMs: q.toMs })?.points ??
        [];
      const merged = assemble(trackId, [...older, ...raw], q);
      return merged
        ? { slice: merged, source: "memory+database" }
        : { slice, source: "memory" };
    },
  };
}
