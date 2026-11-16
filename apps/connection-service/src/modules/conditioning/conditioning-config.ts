import { type Env, str } from "../feed/feed-env";
import { DEFAULT_GHOST_OPTIONS, type GhostFilterOptions } from "./ghost-filter";
import {
  DEFAULT_STABILIZER_OPTIONS,
  type StabilizerOptions,
} from "./track-stabilizer";

export interface ConditioningConfig {
  ghost: { enabled: boolean; options: GhostFilterOptions };
  stabilizer: { enabled: boolean; options: StabilizerOptions };
  warnings: string[];
}

const isOff = (raw: string | undefined): boolean =>
  ["false", "0", "off", "no"].includes((raw ?? "").trim().toLowerCase());

/** Angka positif dari env; nilai bawaan (dengan peringatan) bila diisi tetapi tidak bisa dipakai. */
function positive(
  env: Env,
  key: string,
  fallback: number,
  warnings: string[],
  integer = false,
): number {
  const raw = str(env[key]);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && (!integer || Number.isInteger(n)))
    return n;
  warnings.push(
    `${key}="${raw}" is not a positive ${integer ? "whole " : ""}number — using ${fallback}`,
  );
  return fallback;
}

/**
 * Pengondisian track sebelum sampai ke peta dan alert. Keduanya aktif secara bawaan.
 *
 * Penyaring bayangan (target tanpa identitas yang hanya gema target lain dari sensor yang sama):
 *   GHOST_FILTER_ENABLED         default true
 *   GHOST_RADIUS_M               dalam jarak ini dari target beridentitas = bayangan (40)
 *   GHOST_MIN_REPORTS            laporan sebelum target tanpa identitas dianggap nyata (3)
 *   GHOST_MAX_AGE_MS             laporan target beridentitas yang lebih tua tidak dipakai sebagai pembanding (2000)
 *
 * Penstabil target di permukaan (diam jadi titik, bergerak jadi garis mulus, arah stabil):
 *   TRACK_STABILIZER_ENABLED     default true
 *   STABILIZER_STAND_KT          di bawah ini (knot) dianggap diam atau merayap (6)
 *   STABILIZER_RADIUS_M          zona mati saat diam atau merayap: derau sejauh ini tidak menggeser posisi, meter (15)
 *   STABILIZER_MOVE_RADIUS_M     zona mati saat bergerak normal; sekaligus selisih posisi tampil dan sensor, meter (3)
 *   STABILIZER_MAX_JUMP_KT       langkah lebih cepat dari ini dan dari 3x kecepatan pesawat sendiri = lonjakan palsu di permukaan (80)
 *   STABILIZER_MAX_AIR_JUMP_KT   sama untuk pesawat di udara; satu laporan pencilan puluhan km tidak masuk ke jejak (1000)
 *   STABILIZER_HEADING_MIN_M     arah baru dihitung dari gerak sejauh ini, meter (10)
 */
export function conditioningConfigFromEnv(env: Env): ConditioningConfig {
  const warnings: string[] = [];
  const g = DEFAULT_GHOST_OPTIONS;
  const s = DEFAULT_STABILIZER_OPTIONS;
  return {
    warnings,
    ghost: {
      enabled: !isOff(env.GHOST_FILTER_ENABLED),
      options: {
        ...g,
        radiusM: positive(env, "GHOST_RADIUS_M", g.radiusM, warnings),
        minReports: positive(
          env,
          "GHOST_MIN_REPORTS",
          g.minReports,
          warnings,
          true,
        ),
        maxAgeMs: positive(env, "GHOST_MAX_AGE_MS", g.maxAgeMs, warnings),
      },
    },
    stabilizer: {
      enabled: !isOff(env.TRACK_STABILIZER_ENABLED),
      options: {
        ...s,
        standKt: positive(env, "STABILIZER_STAND_KT", s.standKt, warnings),
        radiusM: positive(env, "STABILIZER_RADIUS_M", s.radiusM, warnings),
        moveRadiusM: positive(
          env,
          "STABILIZER_MOVE_RADIUS_M",
          s.moveRadiusM,
          warnings,
        ),
        maxJumpKt: positive(
          env,
          "STABILIZER_MAX_JUMP_KT",
          s.maxJumpKt,
          warnings,
        ),
        maxAirJumpKt: positive(
          env,
          "STABILIZER_MAX_AIR_JUMP_KT",
          s.maxAirJumpKt,
          warnings,
        ),
        headingMinMoveM: positive(
          env,
          "STABILIZER_HEADING_MIN_M",
          s.headingMinMoveM,
          warnings,
        ),
      },
    },
  };
}
