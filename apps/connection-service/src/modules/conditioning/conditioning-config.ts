import { type Env, str } from "../feed/feed-env";
import { DEFAULT_GHOST_OPTIONS, type GhostFilterOptions } from "./ghost-filter";
import {
  DEFAULT_MLAT_VALIDATOR_OPTIONS,
  type MlatValidatorOptions,
} from "./mlat-validator";
import {
  DEFAULT_STABILIZER_OPTIONS,
  type StabilizerOptions,
} from "./track-stabilizer";

export interface ConditioningConfig {
  ghost: { enabled: boolean; options: GhostFilterOptions };
  stabilizer: { enabled: boolean; options: StabilizerOptions };
  mlat: { enabled: boolean; options: MlatValidatorOptions };
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

/** Bilangan bulat 0 atau lebih dari env (0 = mati); nilai bawaan (dengan peringatan) bila tidak bisa dipakai. */
function wholeFromZero(
  env: Env,
  key: string,
  fallback: number,
  warnings: string[],
): number {
  const raw = str(env[key]);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  warnings.push(
    `${key}="${raw}" is not a whole number of 0 or more — using ${fallback}`,
  );
  return fallback;
}

/** Angka pecahan dari env; nilai bawaan (dengan peringatan) bila diisi tetapi tidak bisa dipakai. */
function fraction(
  env: Env,
  key: string,
  fallback: number,
  warnings: string[],
): number {
  const raw = str(env[key]);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  warnings.push(
    `${key}="${raw}" is not between 0 (exclusive) and 1 — using ${fallback}`,
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
 *   GHOST_HIDE_UNIDENTIFIED      sembunyikan SEMUA target tanpa identitas (r1-1-123), bukan hanya gema (default true; false/0/off/no menampilkannya)
 *   GHOST_ESTABLISHED_REPORTS    target tanpa identitas dengan sekian laporan dianggap mapan: jadi induk gema, tidak pernah gema (10; 0 = mati)
 *
 * Penstabil target di permukaan (diam jadi titik, bergerak jadi garis mulus, arah stabil):
 *   TRACK_STABILIZER_ENABLED     default true
 *   STABILIZER_STAND_KT          di bawah ini (knot) dianggap diam atau merayap (6)
 *   STABILIZER_RADIUS_M          zona mati saat diam atau merayap: derau sejauh ini tidak menggeser posisi, meter (15)
 *   STABILIZER_MOVE_RADIUS_M     zona mati saat bergerak normal; sekaligus selisih posisi tampil dan sensor, meter (3)
 *   STABILIZER_MAX_JUMP_KT       langkah lebih cepat dari ini dan dari 3x kecepatan pesawat sendiri = lonjakan palsu di permukaan (80)
 *   STABILIZER_MAX_AIR_JUMP_KT   sama untuk pesawat di udara; satu laporan pencilan puluhan km tidak masuk ke jejak (1000)
 *   STABILIZER_HEADING_MIN_M     arah baru dihitung dari gerak sejauh ini, meter (10)
 *
 * Validasi keandalan data MLAT (khusus pesawat, bukan kendaraan):
 *   MLAT_VALIDATION_ENABLED      default true
 *   MLAT_MAX_GROUND_JUMP_KT      batas lonjakan posisi di permukaan (150)
 *   MLAT_MAX_AIR_JUMP_KT         batas lonjakan posisi di udara (800)
 *   MLAT_MIN_CONFIDENCE          ambang minimum keyakinan (0.4)
 *   MLAT_UNRELIABLE_THRESHOLD    jumlah laporan anomali berturut-turut sebelum ditarik (3)
 *   MLAT_RECOVERY_THRESHOLD      jumlah laporan valid berturut-turut untuk pulih (3)
 *   MLAT_MAX_STALE_MS            batas waktu sebelum dianggap basi (10000)
 *   MLAT_MAX_ALTITUDE_FT         batas ketinggian cakupan MLAT (5000, 0 = tanpa batas)
 */
export function conditioningConfigFromEnv(env: Env): ConditioningConfig {
  const warnings: string[] = [];
  const g = DEFAULT_GHOST_OPTIONS;
  const s = DEFAULT_STABILIZER_OPTIONS;
  const m = DEFAULT_MLAT_VALIDATOR_OPTIONS;
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
        // Bawaan aktif di aplikasi; pustaka ghost-filter sendiri bawaannya mati.
        hideUnidentified: !isOff(env.GHOST_HIDE_UNIDENTIFIED),
        establishedReports: wholeFromZero(
          env,
          "GHOST_ESTABLISHED_REPORTS",
          g.establishedReports,
          warnings,
        ),
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
    mlat: {
      enabled: !isOff(env.MLAT_VALIDATION_ENABLED),
      options: {
        ...m,
        enabled: !isOff(env.MLAT_VALIDATION_ENABLED),
        maxGroundJumpSpeedKt: positive(
          env,
          "MLAT_MAX_GROUND_JUMP_KT",
          m.maxGroundJumpSpeedKt,
          warnings,
        ),
        maxAirJumpSpeedKt: positive(
          env,
          "MLAT_MAX_AIR_JUMP_KT",
          m.maxAirJumpSpeedKt,
          warnings,
        ),
        minConfidence: fraction(
          env,
          "MLAT_MIN_CONFIDENCE",
          m.minConfidence,
          warnings,
        ),
        unreliableThreshold: positive(
          env,
          "MLAT_UNRELIABLE_THRESHOLD",
          m.unreliableThreshold,
          warnings,
          true,
        ),
        recoveryThreshold: positive(
          env,
          "MLAT_RECOVERY_THRESHOLD",
          m.recoveryThreshold,
          warnings,
          true,
        ),
        maxStaleMs: positive(env, "MLAT_MAX_STALE_MS", m.maxStaleMs, warnings),
        maxAltitudeFt: positive(
          env,
          "MLAT_MAX_ALTITUDE_FT",
          m.maxAltitudeFt,
          warnings,
          true,
        ),
      },
    },
  };
}
