import type { MovementTrack } from "../../types";
import { haversineMeters, type LatLon } from "./geometry";

const KT_TO_MPS = 0.514444;
const M_PER_DEG = 111_320;

/** Posisi target `seconds` detik ke depan dengan kecepatan dan arah tetap. Tanpa kecepatan atau arah, ia dianggap diam. */
export function projectTrack(track: MovementTrack, seconds: number): LatLon {
  const speed = track.groundSpeed ?? 0;
  if (speed <= 0 || track.heading === undefined || seconds <= 0) {
    return [track.latitude, track.longitude];
  }
  const metres = speed * KT_TO_MPS * seconds;
  const rad = (track.heading * Math.PI) / 180;
  const north = Math.cos(rad) * metres;
  const east = Math.sin(rad) * metres;
  return [
    track.latitude + north / M_PER_DEG,
    track.longitude +
      east / (M_PER_DEG * Math.cos((track.latitude * Math.PI) / 180)),
  ];
}

export interface Approach {
  /** Jarak sekarang, meter. */
  distanceM: number;
  /** Jarak terdekat dalam `horizonSeconds` ke depan bila keduanya meneruskan geraknya, meter. */
  closestM: number;
  /** Mendekat: dalam jangka itu mereka menjadi lebih dekat daripada sekarang. */
  closing: boolean;
}

/**
 * Apakah dua target saling mendekat. Jarak yang sama sekarang tidak berarti bahaya bila keduanya diam (parkir berdampingan) atau saling menjauh
 * (mengikuti di taxiway), jadi yang dinilai adalah jarak terdekat dalam beberapa detik ke depan.
 */
export function approach(
  a: MovementTrack,
  b: MovementTrack,
  horizonSeconds: number,
  toleranceM = 1,
): Approach {
  const distanceM = haversineMeters(
    [a.latitude, a.longitude],
    [b.latitude, b.longitude],
  );
  let closestM = distanceM;
  for (const fraction of [0.5, 1]) {
    const s = horizonSeconds * fraction;
    closestM = Math.min(
      closestM,
      haversineMeters(projectTrack(a, s), projectTrack(b, s)),
    );
  }
  return { distanceM, closestM, closing: closestM < distanceM - toleranceM };
}
