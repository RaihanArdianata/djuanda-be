import { type Env, str } from "../feed/feed-env";
import type { FusionOptions } from "./track-fuser";

/** MLAT / surface sensors know the apron best. */
export const DEFAULT_SURFACE_PRIORITY: string[] = [
  "asterix-cat010",
  "asterix-cat011",
  "asterix-cat020",
  "asterix-cat021",
  "asterix-cat048",
  "asterix-cat062",
];

/** In the air the system track and radar are the better position. */
export const DEFAULT_AIRBORNE_PRIORITY: string[] = [
  "asterix-cat062",
  "asterix-cat048",
  "asterix-cat021",
  "asterix-cat020",
  "asterix-cat010",
  "asterix-cat011",
];

export interface FusionConfig {
  enabled: boolean;
  options: FusionOptions;
  warnings: string[];
}

function priorityList(raw: string | undefined, fallback: string[]): string[] {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
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
 *   FUSION_SPATIAL              also match tracks without a shared Mode-S address (false)
 *   FUSION_MATCH_RADIUS_M       ... within this distance (150)
 *   FUSION_MATCH_MAX_SKEW_MS    ... and this time difference (3000)
 *   FUSION_DISAGREE_M           sensors further apart are reported (300)
 */
export function fusionConfigFromEnv(env: Env): FusionConfig {
  const warnings: string[] = [];
  return {
    enabled: !isOff(env.FUSION_ENABLED),
    warnings,
    options: {
      surfacePriority: priorityList(
        env.FUSION_SURFACE_PRIORITY,
        DEFAULT_SURFACE_PRIORITY,
      ),
      airbornePriority: priorityList(
        env.FUSION_AIRBORNE_PRIORITY,
        DEFAULT_AIRBORNE_PRIORITY,
      ),
      maxSourceAgeMs: positive(
        env,
        "FUSION_MAX_SOURCE_AGE_MS",
        5_000,
        warnings,
      ),
      forgetAfterMs: positive(env, "FUSION_FORGET_AFTER_MS", 600_000, warnings),
      spatial: isOn(env.FUSION_SPATIAL),
      matchRadiusM: positive(env, "FUSION_MATCH_RADIUS_M", 150, warnings),
      matchMaxSkewMs: positive(
        env,
        "FUSION_MATCH_MAX_SKEW_MS",
        3_000,
        warnings,
      ),
      disagreeM: positive(env, "FUSION_DISAGREE_M", 300, warnings),
    },
  };
}
