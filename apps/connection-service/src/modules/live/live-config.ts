import type { Bbox, ExitRemovalOptions } from "@aeroswarm/live-server";

type Env = Record<string, string | undefined>;

export interface LiveConfig {
  /** Status turns "stale" after this much silence. Undefined = package default (15 s). */
  staleAfterMs?: number;
  /** Status turns "lost". Undefined = package default (90 s). */
  lostAfterMs?: number;
  /** A track unseen this long is removed. 0 disables. Undefined = default (30 min). */
  removeAfterMs?: number;
  /** Ignore tracks outside this box unless they are heading into it. */
  interestBbox?: Bbox;
  interestLookaheadMin?: number;
  /** Remove aircraft that have passed through `interestBbox`. Does nothing without a box. */
  exit: ExitRemovalOptions;
  /** Per-client, per-track push rate when a client does not ask. Default 10. */
  defaultUpdateHz?: number;
  heartbeatMs?: number;
  /** How often lifecycle (stale/lost/removed) is re-evaluated. Default 5000. */
  sweepMs: number;
  warnings: string[];
}

/** Positive finite number, or undefined; `allowZero` for settings where 0 means "off". */
function num(
  env: Env,
  key: string,
  warnings: string[],
  allowZero = false,
): number | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || (n === 0 && !allowZero)) {
    warnings.push(`${key}="${raw}" is not a valid number — using the default`);
    return undefined;
  }
  return n;
}

/** "minLon,minLat,maxLon,maxLat" */
function bbox(env: Env, warnings: string[]): Bbox | undefined {
  const raw = env.INTEREST_BBOX?.trim();
  if (!raw) return undefined;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  const [minLon, minLat, maxLon, maxLat] = parts;
  const valid =
    parts.length === 4 &&
    parts.every(Number.isFinite) &&
    (minLon as number) < (maxLon as number) &&
    (minLat as number) < (maxLat as number) &&
    Math.abs(minLat as number) <= 90 &&
    Math.abs(maxLat as number) <= 90 &&
    Math.abs(minLon as number) <= 180 &&
    Math.abs(maxLon as number) <= 180;
  if (!valid) {
    warnings.push(
      `INTEREST_BBOX="${raw}" must be "minLon,minLat,maxLon,maxLat" — ignored`,
    );
    return undefined;
  }
  return parts as Bbox;
}

const isOff = (raw: string | undefined): boolean =>
  ["false", "0", "off", "no"].includes((raw ?? "").trim().toLowerCase());

/**
 * An aircraft that has been inside INTEREST_BBOX and then leaves it disappears at once.
 * On by default, but it only acts when INTEREST_BBOX is set.
 */
function exitOptions(
  env: Env,
  warnings: string[],
  hasBbox: boolean,
): ExitRemovalOptions {
  const explicit = env.EXIT_REMOVE_ENABLED?.trim();
  const enabled = !isOff(explicit);
  if (explicit && enabled && !hasBbox) {
    warnings.push(
      "EXIT_REMOVE_ENABLED is set but INTEREST_BBOX is not: an aircraft is removed after it leaves the interest box, so without one nothing is removed",
    );
  }
  const confirm = num(env, "EXIT_CONFIRM_FIXES", warnings);
  return {
    enabled,
    marginM: num(env, "EXIT_MARGIN_M", warnings, true),
    confirmFixes:
      confirm === undefined ? undefined : Math.max(1, Math.floor(confirm)),
    suppressMs: num(env, "EXIT_SUPPRESS_MS", warnings),
  };
}

/**
 * Live-picture settings from env:
 *   STALE_AFTER_MS, LOST_AFTER_MS, TRACK_REMOVE_AFTER_MS (0 = never remove)
 *   INTEREST_BBOX ("minLon,minLat,maxLon,maxLat"), INTEREST_LOOKAHEAD_MIN
 *   EXIT_REMOVE_ENABLED (true), EXIT_MARGIN_M (1000; 0 allowed), EXIT_CONFIRM_FIXES (2),
 *   EXIT_SUPPRESS_MS (600000)
 *   WS_DEFAULT_UPDATE_HZ, WS_HEARTBEAT_MS, TRACK_SWEEP_MS
 * Bad values warn and fall back to the default; the service still starts.
 */
export function liveConfigFromEnv(env: Env): LiveConfig {
  const warnings: string[] = [];
  const staleAfterMs = num(env, "STALE_AFTER_MS", warnings);
  const lostAfterMs = num(env, "LOST_AFTER_MS", warnings);
  const interestBbox = bbox(env, warnings);
  const config: LiveConfig = {
    staleAfterMs,
    lostAfterMs,
    removeAfterMs: num(env, "TRACK_REMOVE_AFTER_MS", warnings, true),
    interestBbox,
    interestLookaheadMin: num(env, "INTEREST_LOOKAHEAD_MIN", warnings),
    exit: exitOptions(env, warnings, interestBbox !== undefined),
    defaultUpdateHz: num(env, "WS_DEFAULT_UPDATE_HZ", warnings),
    heartbeatMs: num(env, "WS_HEARTBEAT_MS", warnings),
    sweepMs: num(env, "TRACK_SWEEP_MS", warnings) ?? 5000,
    warnings,
  };
  // stale must come before lost, or every track would skip straight to lost.
  if (
    config.staleAfterMs !== undefined &&
    config.lostAfterMs !== undefined &&
    config.staleAfterMs >= config.lostAfterMs
  ) {
    warnings.push(
      "STALE_AFTER_MS must be smaller than LOST_AFTER_MS — both reset to defaults",
    );
    config.staleAfterMs = undefined;
    config.lostAfterMs = undefined;
  }
  return config;
}
