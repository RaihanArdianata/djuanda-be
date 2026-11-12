/** Jarak (meter) dan arah (derajat, 0 = utara) pada bidang datar; cukup untuk jarak antar target di satu bandara. */
const M_PER_DEG: number = 111_320;
const RAD: number = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

export function distanceM(a: LatLon, b: LatLon): number {
  const north = (b.lat - a.lat) * M_PER_DEG;
  const east =
    (b.lon - a.lon) * M_PER_DEG * Math.cos(((a.lat + b.lat) / 2) * RAD);
  return Math.hypot(north, east);
}

export function bearingDeg(from: LatLon, to: LatLon): number {
  const north = to.lat - from.lat;
  const east = (to.lon - from.lon) * Math.cos(((from.lat + to.lat) / 2) * RAD);
  return (((Math.atan2(east, north) / RAD) % 360) + 360) % 360;
}

/** Selisih sudut terpendek, derajat (0 sampai 180). */
export function angleDiff(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** Interpolasi sudut lewat jalur terpendek. */
export function lerpAngle(a: number, b: number, f: number): number {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + delta * f + 360) % 360;
}
