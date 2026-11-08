/**
 * Penyaring titik riwayat track. Riwayat yang direkam untuk alert dikumpulkan dari setiap laporan yang masuk untuk sebuah pesawat
 * (radar, MLAT, ADS-B, relay); sensor yang berselisih puluhan sampai ratusan meter membuat jejak bolak-balik dan bertumpuk. Sebuah
 * laporan hanya masuk riwayat bila masuk akal sebagai kelanjutan titik sebelumnya: waktunya maju dan jaraknya tidak lebih dari yang
 * mungkin ditempuh. Dengan begitu yang tersimpan satu jalur yang konsisten. Aturan yang sama dipakai FE untuk riwayat lama.
 */

const M_PER_DEG = 111_320;
const KT_TO_MPS = 0.514444;

/** Selisih posisi antar sensor/derau yang masih dimaklumi di luar jarak yang mungkin ditempuh, meter. */
export const POSITION_NOISE_M = 60;
/** Kecepatan minimum yang dianggap mungkin (m/s, sekitar 15 kt). */
const MIN_SPEED_MPS = 8;
/** Pesawat boleh lebih cepat dari yang dilaporkan sebelum dianggap melompat. */
const SPEED_MARGIN = 1.5;
/** Setelah sekian laporan berturut-turut ditolak, jalur dianggap pindah (jalur lama yang keliru) dan dipakai yang baru. */
export const MAX_REJECTS = 3;

export interface GatePoint {
  latitude: number;
  longitude: number;
  groundSpeed?: number | null;
  /** epoch ms */
  at: number;
}

function distanceMeters(a: GatePoint, b: GatePoint): number {
  const dLat = (b.latitude - a.latitude) * M_PER_DEG;
  const dLon =
    (b.longitude - a.longitude) *
    M_PER_DEG *
    Math.cos(((a.latitude + b.latitude) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/** Apakah `next` masuk akal sebagai kelanjutan `last`. */
export function plausibleStep(last: GatePoint, next: GatePoint): boolean {
  const dtS = (next.at - last.at) / 1000;
  if (dtS <= 0) return false;
  const speedKt = Math.max(last.groundSpeed ?? 0, next.groundSpeed ?? 0);
  const speed = Math.max(speedKt * KT_TO_MPS * SPEED_MARGIN, MIN_SPEED_MPS);
  return distanceMeters(last, next) <= POSITION_NOISE_M + speed * dtS;
}

export interface GateState {
  rejects: number;
}

export const newGateState = (): GateState => ({ rejects: 0 });

/**
 * Putusan untuk satu laporan: true = masuk riwayat. Titik pertama selalu masuk. Laporan yang ditolak berturut-turut sebanyak
 * `MAX_REJECTS` dianggap jalur yang berpindah, jadi laporan itu masuk dan hitungan dimulai lagi.
 */
export function admit(
  last: GatePoint | undefined,
  next: GatePoint,
  state: GateState,
): boolean {
  if (!last || plausibleStep(last, next)) {
    state.rejects = 0;
    return true;
  }
  state.rejects++;
  if (state.rejects >= MAX_REJECTS) {
    state.rejects = 0;
    return true;
  }
  return false;
}
