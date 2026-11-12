import type { MovementTrack } from "./types";

/** Track tanpa flag onGround tapi altitude MSL di atas ini jelas airborne (sama dengan aturan incursion). */
export const AIRBORNE_ALTITUDE_FT = 500;

/**
 * Plafon taksi (ft): rendah dan lambat di bawah ini dianggap di darat, meski onGround=false.
 * Diselaraskan dengan `SURFACE_MAX_ALT_FT` di connection-service. 400 ft / 30 kt masih udara.
 */
export const SURFACE_MAX_ALT_FT = 100;

/** Di bawah kecepatan ini (dan rendah), target tidak mungkin sedang terbang. */
export const MIN_AIRBORNE_SPEED_KT = 40;

/**
 * Satu keputusan "di udara atau di darat" untuk STCA dan area alert.
 *
 * Flag onGround=true dipercaya. Flag onGround=false tidak dipercaya mentah-mentah: sumber MLAT/radar kadang tidak menandai
 * kendaraan/pesawat taksi sebagai surface, jadi target yang rendah (≤ 100 ft) dan lambat tetap dianggap di darat. Tanpa flag,
 * target dianggap di udara hanya bila altitudenya jelas di atas permukaan.
 */
export function isAirborne(track: MovementTrack): boolean {
  if (track.onGround === true) return false;
  const lowAndSlow =
    track.altitude !== undefined &&
    track.altitude <= SURFACE_MAX_ALT_FT &&
    track.groundSpeed !== undefined &&
    track.groundSpeed < MIN_AIRBORNE_SPEED_KT;
  if (lowAndSlow) return false;
  if (track.onGround === false) return true;
  return track.altitude !== undefined && track.altitude > AIRBORNE_ALTITUDE_FT;
}
