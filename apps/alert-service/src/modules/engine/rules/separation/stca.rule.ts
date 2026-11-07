import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";

const DEFAULT_HORIZON_SECONDS = 60;

/** Track tanpa flag onGround tapi altitude MSL di atas ini jelas airborne (sama dengan aturan incursion). */
const AIRBORNE_ALTITUDE_FT = 500;

/** Di bawah kecepatan ini (dan rendah), target tidak mungkin sedang terbang. */
const MIN_AIRBORNE_SPEED_KT = 40;

/**
 * STCA adalah peringatan konflik di UDARA. Target di darat (taksi, parkir, kendaraan) tidak ikut:
 * konflik di permukaan ditangani aturan incursion, dan ambang pemisahan STCA (bawaan 3 NM) jauh
 * lebih besar dari jarak antar target di apron, sehingga dua target yang diam pun memicu alert.
 * Tanpa flag onGround, target dianggap di udara hanya bila altitudenya jelas di atas permukaan.
 * Flag onGround=false tidak dipercaya mentah-mentah: sumber MLAT/radar kadang tidak menandai
 * kendaraan/pesawat taksi sebagai surface, jadi target yang rendah dan lambat tetap dianggap di darat.
 */
function isAirborne(track: AlertContext["tracks"][0]): boolean {
  if (track.onGround === true) return false;
  const lowAndSlow =
    track.altitude !== undefined &&
    track.altitude <= AIRBORNE_ALTITUDE_FT &&
    track.groundSpeed !== undefined &&
    track.groundSpeed < MIN_AIRBORNE_SPEED_KT;
  if (lowAndSlow) return false;
  if (track.onGround === false) return true;
  return track.altitude !== undefined && track.altitude > AIRBORNE_ALTITUDE_FT;
}

/** Pemisahan vertikal minimum bawaan (ft) bila aturan tidak mengisinya; `0` atau `null` di konfigurasi mematikan pemeriksaan vertikal. */
const DEFAULT_MIN_VERTICAL_FT = 1000;

function minimumVerticalFt(
  config: Record<string, unknown>,
): number | undefined {
  const value = config.minimumVerticalSeparationFt;
  if (value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_MIN_VERTICAL_FT;
  return value > 0 ? value : undefined;
}

export const stcaRule: DetectionRule = {
  type: "STCA",
  // biome-ignore-start lint/complexity/noExcessiveCognitiveComplexity: STCA logic
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const horizon =
      typeof config.predictionTimeSeconds === "number"
        ? config.predictionTimeSeconds
        : DEFAULT_HORIZON_SECONDS;

    // `includeSurface: true` mengembalikan perilaku lama (semua target, termasuk di darat).
    const airborne =
      config.includeSurface === true
        ? ctx.tracks
        : ctx.tracks.filter(isAirborne);
    // Target yang tidak melaporkan ketinggian (banyak track radar) tidak bisa dinilai pemisahan vertikalnya, dan flag udara/darat
    // mereka tidak bisa dipercaya: tidak ikut STCA. `requireAltitude: false` mengembalikan perilaku lama.
    const tracks =
      config.requireAltitude === false
        ? airborne
        : airborne.filter((t) => t.altitude !== undefined);
    const minVertical = minimumVerticalFt(config);

    const candidates: AlertCandidate[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const a = tracks[i];
        const b = tracks[j];

        // Callsign sama = satu pesawat yang terlihat dua kali (dua trackId dari dua jalur feed),
        // bukan dua pesawat yang berdekatan.
        if (a.callsign && a.callsign === b.callsign) continue;

        const pairKey = [a.trackId, b.trackId].sort().join("|");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const predictedA = predict(a, horizon);
        const predictedB = predict(b, horizon);

        const distanceNm = haversineNm(predictedA, predictedB);

        if (minVertical !== undefined) {
          if (a.altitude === undefined || b.altitude === undefined) continue;
          const verticalDiff = Math.abs(a.altitude - b.altitude);
          if (verticalDiff >= minVertical) continue;
        }

        if (
          distanceNm < ((config.minimumHorizontalSeparationNm as number) ?? 3)
        ) {
          const alertId = `STCA|${ctx.airportId}|${pairKey}`;
          const callsignA = a.callsign ?? a.trackId;
          const callsignB = b.callsign ?? b.trackId;
          candidates.push({
            alertId,
            airportId: ctx.airportId,
            type: "STCA",
            severity: "CRITICAL",
            status: "ACTIVE",
            trackId: a.trackId,
            relatedTrackId: b.trackId,
            triggeredAt: ctx.timestamp,
            data: {
              callsign: callsignA,
              relatedCallsign: callsignB,
              message: `${callsignA} and ${callsignB} predicted below minimum separation (${distanceNm.toFixed(2)} NM in ${horizon}s)`,
              latitude: (a.latitude + b.latitude) / 2,
              longitude: (a.longitude + b.longitude) / 2,
              track: trackSnapshot(a),
              relatedTrack: trackSnapshot(b),
              predictedTimeSeconds: horizon,
              horizontalSeparationNm: distanceNm,
              minimumHorizontalSeparationNm:
                config.minimumHorizontalSeparationNm,
              predictedVerticalSeparationFt:
                a.altitude !== undefined && b.altitude !== undefined
                  ? Math.abs(a.altitude - b.altitude)
                  : null,
              minimumVerticalSeparationFt: minVertical ?? null,
            },
          });
        }
      }
    }

    return candidates;
  },
  // biome-ignore-end lint/complexity/noExcessiveCognitiveComplexity: STCA logic
};

function trackSnapshot(track: AlertContext["tracks"][0]): {
  trackId: string;
  callsign: string;
  registration: string | null;
  targetType: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  groundSpeed: number | null;
  heading: number | null;
  onGround: boolean | null;
  timestamp: string;
} {
  return {
    trackId: track.trackId,
    callsign: track.callsign ?? track.trackId,
    registration: track.registration ?? null,
    targetType: track.targetType ?? "AIRCRAFT",
    latitude: track.latitude,
    longitude: track.longitude,
    altitude: track.altitude ?? null,
    groundSpeed: track.groundSpeed ?? null,
    heading: track.heading ?? null,
    onGround: track.onGround ?? null,
    timestamp: track.timestamp.toISOString(),
  };
}

function predict(
  track: AlertContext["tracks"][0],
  seconds: number,
): { latitude: number; longitude: number } {
  const speedKnots = track.groundSpeed ?? 0;
  const heading = track.heading ?? 0;
  const distanceNm = (speedKnots * seconds) / 3600;

  const latRad = (track.latitude * Math.PI) / 180;
  const lonRad = (track.longitude * Math.PI) / 180;
  const bearing = (heading * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(latRad) * Math.cos(distanceNm / 3440) +
      Math.cos(latRad) * Math.sin(distanceNm / 3440) * Math.cos(bearing),
  );
  const lon2 =
    lonRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distanceNm / 3440) * Math.cos(latRad),
      Math.cos(distanceNm / 3440) - Math.sin(latRad) * Math.sin(lat2),
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI,
  };
}

function haversineNm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 3440;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
