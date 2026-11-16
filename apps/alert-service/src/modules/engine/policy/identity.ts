import type { MovementTrack } from "../types";

/**
 * Target "ber-identitas": punya callsign, registrasi, atau armada kendaraan. Target tanpa itu (track radar tanpa Mode-S, gema sensor, kendaraan
 * yang tidak melaporkan nama) tidak boleh memicu alert Critical atau Warning: paling tinggi Info, dan baru setelah bertahan cukup lama.
 */
export function isIdentified(track: MovementTrack): boolean {
  return Boolean(
    track.callsign?.trim() || track.registration?.trim() || track.vehicleFleet,
  );
}

/** Bergerak: kecepatan di atas ambang (knot). Target yang diam tidak "memasuki" apa pun, ia hanya berada di sana. */
export function isMovingAbove(
  track: MovementTrack,
  thresholdKt: number,
): boolean {
  return (track.groundSpeed ?? 0) >= thresholdKt;
}

/** Track yang melaporkan ia di permukaan; tanpa penanda, di bawah ketinggian ini dianggap di permukaan. */
const AIRBORNE_ALTITUDE_FT = 500;

export function isOnSurface(track: MovementTrack): boolean {
  if (track.onGround === false) return false;
  if (
    track.onGround === undefined &&
    track.altitude !== undefined &&
    track.altitude > AIRBORNE_ALTITUDE_FT
  )
    return false;
  return true;
}
