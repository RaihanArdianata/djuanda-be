import {
  DEFAULT_AIRBORNE_PRIORITY,
  DEFAULT_SURFACE_PRIORITY,
  defaultFusionOptions,
  type FusionOptions,
} from "@aeroswarm/live-server";
import { type Env, str } from "../feed/feed-env";

// The defaults (MLAT first, 5 s, 150 m, ...) live in @aeroswarm/live-server, so every
// project that uses the fuser starts from the same values. Here only the env names.
export { DEFAULT_AIRBORNE_PRIORITY, DEFAULT_SURFACE_PRIORITY };

export interface FusionConfig {
  enabled: boolean;
  options: FusionOptions;
  warnings: string[];
}

function priorityList(
  raw: string | undefined,
  fallback: readonly string[],
): string[] {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : [...fallback];
}

/** A positive number from env; the default (with a warning) when set but unusable. */
function positive(
  env: Env,
  key: string,
  fallback: number,
  warnings: string[],
): number {
  const raw = str(env[key]);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  warnings.push(`${key}="${raw}" is not a positive number — using ${fallback}`);
  return fallback;
}

/** Zero or more: `0` switches the setting off. The default (with a warning) when set but unusable. */
function nonNegative(
  env: Env,
  key: string,
  fallback: number,
  warnings: string[],
): number {
  const raw = str(env[key]);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  warnings.push(
    `${key}="${raw}" is not a number of 0 or more — using ${fallback}`,
  );
  return fallback;
}

/** The sticky window of the fuser; needs @aeroswarm/live-server with `stickyMs` (older versions ignore it). */
const DEFAULT_STICKY_MS = 10_000;

const isOff = (raw: string | undefined): boolean =>
  ["false", "0", "off", "no"].includes((raw ?? "").trim().toLowerCase());

const isOn = (raw: string | undefined): boolean =>
  ["true", "1", "on", "yes"].includes((raw ?? "").trim().toLowerCase());

/**
 * Fusion of sensors that see the same aircraft. On by default; with a single
 * sensor it changes nothing except keeping the track id stable.
 *
 *   FUSION_ENABLED              default true
 *   FUSION_SURFACE_PRIORITY     comma list, best first (protocol or source id)
 *   FUSION_AIRBORNE_PRIORITY    same, for aircraft in the air
 *   FUSION_MAX_SOURCE_AGE_MS    sensor silent this long stops competing (5000)
 *   FUSION_FORGET_AFTER_MS      sensor forgotten after this long (600000)
 *   FUSION_STICKY_MS            among sensors of the same priority (e.g. many radars) the one shown stays this long (10000; 0 = off)
 *   FUSION_SPATIAL              also match tracks without a shared Mode-S address (false)
 *   FUSION_MATCH_RADIUS_M       ... within this distance (150)
 *   FUSION_MATCH_MAX_SKEW_MS    ... and this time difference (3000)
 *   FUSION_DISAGREE_M           sensors further apart are reported (300)
 */
export function fusionConfigFromEnv(env: Env): FusionConfig {
  const warnings: string[] = [];
  const d = defaultFusionOptions();
  const stickyMs = nonNegative(
    env,
    "FUSION_STICKY_MS",
    (d as { stickyMs?: number }).stickyMs ?? DEFAULT_STICKY_MS,
    warnings,
  );
  return {
    enabled: !isOff(env.FUSION_ENABLED),
    warnings,
    options: {
      surfacePriority: priorityList(
        env.FUSION_SURFACE_PRIORITY,
        d.surfacePriority,
      ),
      airbornePriority: priorityList(
        env.FUSION_AIRBORNE_PRIORITY,
        d.airbornePriority,
      ),
      maxSourceAgeMs: positive(
        env,
        "FUSION_MAX_SOURCE_AGE_MS",
        d.maxSourceAgeMs,
        warnings,
      ),
      forgetAfterMs: positive(
        env,
        "FUSION_FORGET_AFTER_MS",
        d.forgetAfterMs,
        warnings,
      ),
      ...{ stickyMs },
      spatial: isOn(env.FUSION_SPATIAL),
      matchRadiusM: positive(
        env,
        "FUSION_MATCH_RADIUS_M",
        d.matchRadiusM,
        warnings,
      ),
      matchMaxSkewMs: positive(
        env,
        "FUSION_MATCH_MAX_SKEW_MS",
        d.matchMaxSkewMs,
        warnings,
      ),
      disagreeM: positive(env, "FUSION_DISAGREE_M", d.disagreeM, warnings),
    },
  };
}
