import { ENGINE_RULE_TYPE } from "../../config/engine-settings";
import { isAirborne } from "./airborne";
import type { MovementTrack } from "./types";

/**
 * Area alert bandara: alert hanya berlaku untuk target di sekitar bandara. Dua zona dari satu titik pusat (ARP):
 *  - zona darat: lingkaran berjari-jari `groundRadiusM` (meter) untuk target di darat (taksi, parkir, kendaraan, lepas landas/mendarat);
 *  - zona udara: KUBAH untuk pesawat di udara: alasnya lingkaran berjari-jari `airRadiusNm` (NM), tingginya `airCeilingFt` (ft) di atas
 *    pusat dan mengecil ke tepi (setengah elipsoid: (jarak/radius)² + (tinggi/plafon)² <= 1). Tanpa `airCeilingFt` tidak ada batas tinggi.
 * Target di luar zonanya tidak ikut aturan apa pun (bukan STCA, incursion, atau deviasi). Tanpa pusat (belum diisi di konfigurasi
 * aturan `ALERT_AREA` maupun `ALERT_AREA_CENTER`), semua target dievaluasi seperti sebelumnya.
 *
 * Konfigurasi ada di aturan `ALERT_AREA` (halaman aturan alert), bukan aturan pendeteksi: tidak menghasilkan alert sendiri.
 */

export const ALERT_AREA_RULE_TYPE = "ALERT_AREA";

/** Jenis aturan yang hanya berisi konfigurasi dan tidak punya pendeteksi. */
export const CONFIG_ONLY_RULE_TYPES: ReadonlySet<string> = new Set([
  ALERT_AREA_RULE_TYPE,
  ENGINE_RULE_TYPE,
]);

export const DEFAULT_GROUND_RADIUS_M = 5_000;
export const DEFAULT_AIR_RADIUS_NM = 15;

const METERS_PER_NM = 1852;
const METERS_PER_FT = 0.3048;
const EARTH_RADIUS_M = 6_371_008.8;

export interface AlertArea {
  centerLatitude: number;
  centerLongitude: number;
  groundRadiusM: number;
  airRadiusM: number;
  /** Tinggi kubah udara di atas pusat (meter); null = tanpa batas tinggi. */
  airCeilingM: number | null;
}

const positive = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** `ALERT_AREA_CENTER="lat,lon"`; kosong atau salah format berarti tidak ada. */
export function centerFromEnv(
  raw: string | undefined,
): { lat: number; lon: number } | undefined {
  const parts = (raw ?? "").split(",").map((p) => Number(p.trim()));
  const [lat, lon] = parts;
  if (parts.length !== 2 || lat === undefined || lon === undefined)
    return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

/** Area dari konfigurasi aturan `ALERT_AREA`; pusatnya, bila kosong, dari `ALERT_AREA_CENTER`. Null = tanpa batas area. */
export function alertAreaFrom(
  config: Record<string, unknown> | undefined,
  env: Record<string, string | undefined> = process.env,
): AlertArea | null {
  const fallback = centerFromEnv(env.ALERT_AREA_CENTER);
  const lat = finite(config?.centerLatitude) ?? fallback?.lat;
  const lon = finite(config?.centerLongitude) ?? fallback?.lon;
  if (lat === undefined || lon === undefined) return null;
  return {
    centerLatitude: lat,
    centerLongitude: lon,
    groundRadiusM: positive(config?.groundRadiusM, DEFAULT_GROUND_RADIUS_M),
    airRadiusM:
      positive(config?.airRadiusNm, DEFAULT_AIR_RADIUS_NM) * METERS_PER_NM,
    airCeilingM:
      typeof config?.airCeilingFt === "number" &&
      Number.isFinite(config.airCeilingFt) &&
      config.airCeilingFt > 0
        ? config.airCeilingFt * METERS_PER_FT
        : null,
  };
}

/** Jarak great-circle (haversine) dari pusat area, meter. */
export function distanceFromCenterM(
  track: MovementTrack,
  area: AlertArea,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(track.latitude - area.centerLatitude);
  const dLon = toRad(track.longitude - area.centerLongitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(area.centerLatitude)) *
      Math.cos(toRad(track.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Target di dalam zonanya: zona darat (lingkaran) untuk target di darat; untuk pesawat di udara kubah udara, yaitu di dalam radius
 * dan, bila ada plafon, di bawah lengkung kubah. Ketinggian yang tidak dilaporkan dihitung 0 (hanya jarak yang menentukan).
 */
export function isInAlertArea(
  track: MovementTrack,
  area: AlertArea,
  airborne: boolean,
): boolean {
  const d = distanceFromCenterM(track, area);
  if (!airborne) return d <= area.groundRadiusM;
  if (d > area.airRadiusM) return false;
  if (area.airCeilingM === null) return true;
  const heightM = Math.max(0, track.altitude ?? 0) * METERS_PER_FT;
  return (d / area.airRadiusM) ** 2 + (heightM / area.airCeilingM) ** 2 <= 1;
}

/** Target yang ada di dalam zonanya masing-masing; yang di luar tidak ikut aturan apa pun. */
export function tracksInAlertArea(
  tracks: MovementTrack[],
  area: AlertArea,
): MovementTrack[] {
  return tracks.filter((t) => isInAlertArea(t, area, isAirborne(t)));
}
