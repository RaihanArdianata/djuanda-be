import { alertServiceEnv } from "./env";

/**
 * Pengaturan engine alert yang bisa diubah operator di halaman aturan alert (aturan konfigurasi `ALERT_ENGINE`), tanpa restart.
 * Nilai awal dari env (`ALERT_TWIN_RADIUS_M`, `ALERT_TWIN_MAX_SPEED_DIFF_KT`, `ALERT_STALE_GRACE_SECONDS`,
 * `ALERT_OCCUPANCY_STICKY_MS`); isian aturan menggantikannya begitu terbaca, dan yang dikosongkan kembali ke env.
 */
export interface EngineSettings {
  /** Track tanpa nama sedekat ini (meter) dengan track bernama dari jenis sama dianggap pesawat yang sama. 0 = tidak dinilai dari posisi. */
  twinRadiusM: number;
  /** ...dan selisih kecepatannya paling banyak ini (knot). */
  twinMaxSpeedDiffKt: number;
  /** Alert aktif boleh tidak ke-refresh sebanyak ini (detik) sebelum dianggap stale dan di-clear. */
  staleGraceSeconds: number;
  /** Permukaan tetap OCCUPIED sebanyak ini (ms) setelah track terakhir terlihat di dalam. */
  occupancyStickyMs: number;
  /**
   * Kejadian yang sama muncul lagi dalam sekian detik setelah alertnya selesai: alert lama dibuka kembali, bukan dibuat yang baru.
   * Memicu ulang dalam hitungan detik (81% jeda antar alert di bawah semenit) membengkakkan jumlah alert. Bawaan 300 detik; 0 = mati.
   */
  reopenWindowSeconds: number;
}

export const ENGINE_RULE_TYPE = "ALERT_ENGINE";

const DEFAULT_TWIN_RADIUS_M = 60;
const DEFAULT_TWIN_MAX_SPEED_DIFF_KT = 15;
const DEFAULT_REOPEN_WINDOW_SECONDS = 300;

/** Angka tidak negatif; selain itu `fallback`. */
const nonNegative = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;

/** Nilai dari env saja (tanpa isian aturan). */
export function engineSettingsFromEnv(
  env: Record<string, string | undefined> = process.env,
): EngineSettings {
  const fromEnv = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return raw !== undefined && raw.trim() !== ""
      ? nonNegative(n, fallback)
      : fallback;
  };
  return {
    twinRadiusM: fromEnv(env.ALERT_TWIN_RADIUS_M, DEFAULT_TWIN_RADIUS_M),
    twinMaxSpeedDiffKt: fromEnv(
      env.ALERT_TWIN_MAX_SPEED_DIFF_KT,
      DEFAULT_TWIN_MAX_SPEED_DIFF_KT,
    ),
    staleGraceSeconds: alertServiceEnv.staleGraceSeconds,
    occupancyStickyMs: alertServiceEnv.occupancyStickyMs,
    reopenWindowSeconds: fromEnv(
      env.ALERT_REOPEN_WINDOW_SECONDS,
      DEFAULT_REOPEN_WINDOW_SECONDS,
    ),
  };
}

/** Isian aturan di atas nilai env; kunci yang kosong atau tidak valid memakai env. */
export function resolveEngineSettings(
  config: Record<string, unknown> | undefined,
  base: EngineSettings,
): EngineSettings {
  return {
    twinRadiusM: nonNegative(config?.twinRadiusM, base.twinRadiusM),
    twinMaxSpeedDiffKt: nonNegative(
      config?.twinMaxSpeedDiffKt,
      base.twinMaxSpeedDiffKt,
    ),
    staleGraceSeconds: nonNegative(
      config?.staleGraceSeconds,
      base.staleGraceSeconds,
    ),
    occupancyStickyMs: nonNegative(
      config?.occupancyStickyMs,
      base.occupancyStickyMs,
    ),
    reopenWindowSeconds: nonNegative(
      config?.reopenWindowSeconds,
      base.reopenWindowSeconds,
    ),
  };
}

const envDefaults: EngineSettings = engineSettingsFromEnv();

/** Pengaturan yang sedang berlaku; diganti `applyEngineSettings` tiap aturan dibaca. Satu proses melayani satu bandara. */
export const engineSettings: EngineSettings = { ...envDefaults };

/** Terapkan isian aturan `ALERT_ENGINE` (undefined = aturan tidak ada atau mati: kembali ke env). */
export function applyEngineSettings(
  config: Record<string, unknown> | undefined,
): EngineSettings {
  Object.assign(engineSettings, resolveEngineSettings(config, envDefaults));
  return engineSettings;
}
