import type { Bbox } from "@aeroswarm/live-server";

/**
 * Area peminat track dari profil bandara: kotak di sekeliling titik pusat (aturan `ALERT_AREA`: `centerLatitude`, `centerLongitude`,
 * `interestRadiusNm`) menggantikan `INTEREST_BBOX` dari env, dan berubah tanpa restart begitu operator mengubah aturannya.
 * Tanpa `interestRadiusNm` (atau aturan mati/tidak ada) dipakai `INTEREST_BBOX` dari env bila ada.
 */

const NM_M = 1852;
const M_PER_DEG = 111_320;

type Env = Record<string, string | undefined>;

export interface InterestRule {
  enabled: boolean;
  configuration: Record<string, unknown>;
}

/** Subset TrackState yang dipakai; `setInterest` baru ada di @aeroswarm/live-server yang lebih baru. */
export interface InterestTarget {
  setInterest?: (interest: { interestBbox?: Bbox }) => void;
}

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** `"lat,lon"` dari env `ALERT_AREA_CENTER`. */
function centerFromEnv(
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

/** Kotak "minLon,minLat,maxLon,maxLat" sejauh `radiusNm` dari titik; undefined bila titik atau radius tidak ada. */
export function bboxAround(
  lat: number,
  lon: number,
  radiusNm: number,
): Bbox | undefined {
  if (!(radiusNm > 0) || Math.abs(lat) >= 89) return undefined;
  const radiusM = radiusNm * NM_M;
  const dLat = radiusM / M_PER_DEG;
  const dLon = radiusM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  const box: Bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  return box.every(Number.isFinite) &&
    Math.abs(box[1]) <= 90 &&
    Math.abs(box[3]) <= 90
    ? box
    : undefined;
}

/** Kotak dari isian aturan, atau undefined bila aturan tidak memberi titik pusat atau `interestRadiusNm`. */
export function interestBboxFromRule(
  rule: InterestRule | undefined,
  env: Env = process.env,
): Bbox | undefined {
  if (!rule?.enabled) return undefined;
  const radius = num(rule.configuration.interestRadiusNm);
  if (radius === undefined) return undefined;
  const fallback = centerFromEnv(env.ALERT_AREA_CENTER);
  const lat = num(rule.configuration.centerLatitude) ?? fallback?.lat;
  const lon = num(rule.configuration.centerLongitude) ?? fallback?.lon;
  if (lat === undefined || lon === undefined) return undefined;
  return bboxAround(lat, lon, radius);
}

const same = (a: Bbox | undefined, b: Bbox | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-9));

export interface InterestSyncOptions {
  target: InterestTarget;
  /** `INTEREST_BBOX` dari env: dipakai bila aturan tidak memberi kotak. */
  fallback: Bbox | undefined;
  fetchRule: () => Promise<InterestRule | undefined>;
  intervalMs?: number;
  env?: Env;
  log?: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object | string, msg?: string) => void;
  };
}

/** Baca aturan sekarang lalu berkala; terapkan kotak baru ke gambaran udara bila berubah. Mengembalikan fungsi berhenti. */
export function startInterestSync(options: InterestSyncOptions): () => void {
  let current = options.fallback;
  let warned = false;
  let stopped = false;
  // Satu pembacaan pada satu waktu: bila database lambat, putaran berikutnya dilewati, bukan ditumpuk.
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await apply();
    } finally {
      running = false;
    }
  };

  const apply = async (): Promise<void> => {
    let next: Bbox | undefined;
    try {
      next =
        interestBboxFromRule(await options.fetchRule(), options.env) ??
        options.fallback;
    } catch (err) {
      // Database sesaat tidak terjangkau: biarkan kotak yang berlaku.
      options.log?.warn(
        { err },
        "interest area: could not read the airport area rule",
      );
      return;
    }
    if (stopped || same(current, next)) return;
    if (typeof options.target.setInterest !== "function") {
      if (!warned) {
        warned = true;
        options.log?.warn(
          "interest area: the installed @aeroswarm/live-server cannot change the zone while running — update it, or restart after changing the area",
        );
      }
      return;
    }
    options.target.setInterest({ interestBbox: next });
    current = next;
    options.log?.info({ bbox: next ?? null }, "interest area changed");
  };

  void tick();
  const timer = setInterval(() => void tick(), options.intervalMs ?? 60_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
