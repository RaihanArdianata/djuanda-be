import type { TrailStoreOptions } from "@aeroswarm/live-server";
import { type Env, str } from "../feed/feed-env";

export interface TrailConfig {
  enabled: boolean;
  store: TrailStoreOptions;
  /** A time mark on the line every this many ms, aligned to the clock. 0 = none. */
  labelEveryMs: number;
  /** Points returned when a request gives no `limit`. */
  defaultLimit: number;
  /** Ask the database for what memory does not hold (older than this process, or after a restart). */
  dbFallback: boolean;
  /**
   * After a restart the trail of an aircraft already in the air starts empty. With this set, the
   * part before the restart is fetched from the database by Mode-S address, up to this far back.
   * 0 = off. It reads jsonb: add an index on ((data->'identity'->>'icao24'), fused_at) before using it.
   */
  backfillMs: number;
  warnings: string[];
}

/** The most points one response may carry, whatever `limit` asks for. */
export const MAX_LIMIT = 20_000;

const isOff = (raw: string | undefined): boolean =>
  ["false", "0", "off", "no"].includes((raw ?? "").trim().toLowerCase());

/** A number from env; the default (with a warning) when set but unusable. `allowZero` for settings where 0 means "off". */
function number(
  env: Env,
  key: string,
  fallback: number,
  warnings: string[],
  allowZero = false,
): number {
  const raw = str(env[key]);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && (n > 0 || (allowZero && n === 0))) return n;
  warnings.push(`${key}="${raw}" is not a valid number — using ${fallback}`);
  return fallback;
}

/**
 * Trails (the path an aircraft has flown) from env. Everything has a default; bad values warn and fall back.
 *
 *   TRAIL_ENABLED                    true
 *   TRAIL_MIN_DISTANCE_M             100      distance between stored points: the finest detail
 *   TRAIL_TURN_DEG                   10       a turn this sharp adds a point
 *   TRAIL_MAX_GAP_MS                 30000    a point at least this often, even standing still
 *   TRAIL_MAX_POINTS_PER_TRACK       20000    beyond this every second point is dropped and the spacing doubles
 *   TRAIL_MAX_TRACKS                 5000     least recently used trails are dropped beyond this
 *   TRAIL_RETAIN_AFTER_REMOVE_MS     300000   a removed track's trail stays readable this long
 *   TRAIL_LABEL_EVERY_MS             120000   a time mark every 2 minutes; 0 = none
 *   TRAIL_DEFAULT_LIMIT              5000     points returned when the request gives no limit
 *   TRAIL_DB_FALLBACK                true     read the database for what memory does not hold
 *   TRAIL_BACKFILL_MS                0        after a restart, how far back to fetch the earlier part (0 = off)
 */
export function trailConfigFromEnv(env: Env): TrailConfig {
  const warnings: string[] = [];
  return {
    enabled: !isOff(env.TRAIL_ENABLED),
    warnings,
    store: {
      minDistanceM: number(env, "TRAIL_MIN_DISTANCE_M", 100, warnings),
      turnDeg: number(env, "TRAIL_TURN_DEG", 10, warnings),
      maxGapMs: number(env, "TRAIL_MAX_GAP_MS", 30_000, warnings),
      maxPointsPerTrack: Math.floor(
        number(env, "TRAIL_MAX_POINTS_PER_TRACK", 20_000, warnings),
      ),
      maxTracks: Math.floor(number(env, "TRAIL_MAX_TRACKS", 5_000, warnings)),
      retainAfterRemoveMs: number(
        env,
        "TRAIL_RETAIN_AFTER_REMOVE_MS",
        300_000,
        warnings,
      ),
    },
    labelEveryMs: number(env, "TRAIL_LABEL_EVERY_MS", 120_000, warnings, true),
    defaultLimit: Math.min(
      MAX_LIMIT,
      Math.floor(number(env, "TRAIL_DEFAULT_LIMIT", 5_000, warnings)),
    ),
    dbFallback: !isOff(env.TRAIL_DB_FALLBACK),
    backfillMs: number(env, "TRAIL_BACKFILL_MS", 0, warnings, true),
  };
}
