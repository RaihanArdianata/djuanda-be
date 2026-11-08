import {
  admit,
  type GatePoint,
  type GateState,
  newGateState,
} from "./track-gate";
import type { MovementTrack } from "./types";

export interface TrackHistoryRecord {
  trackId: string;
  callsign?: string;
  registration?: string;
  targetType: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  groundSpeed: number | null;
  heading: number | null;
  onGround: boolean | null;
  timestamp: string;
}

const HISTORY_LIMIT = 20;
const EXPIRY_MS = 300_000; // 5 menit

// Riwayat dikelompokkan berdasarkan "stable key" (callsign/registration),
// bukan trackId mentah, karena trackId dari sensor sering berubah tiap update
// meskipun target fisiknya sama.
const history = new Map<string, MovementTrack[]>();

// Map dari trackId ke stable key supaya pemanggil yang punya trackId
// (misal alert-post-history atau getTrackHistory) tetap bisa nemu bucket-nya.
const trackIdToKey = new Map<string, string>();

// Hitungan laporan yang ditolak berturut-turut per bucket (lihat track-gate).
const gates = new Map<string, GateState>();

const gatePoint = (t: MovementTrack): GatePoint => ({
  latitude: t.latitude,
  longitude: t.longitude,
  groundSpeed: t.groundSpeed,
  at: t.timestamp.getTime(),
});

function purgeOld(entries: MovementTrack[]): MovementTrack[] {
  const now = Date.now();
  // Hapus entri yang lebih tua dari EXPIRY_MS; batasi ke HISTORY_LIMIT terakhir.
  const fresh = entries.filter((e) => now - e.timestamp.getTime() < EXPIRY_MS);
  return fresh.slice(-HISTORY_LIMIT);
}

export function resolveTrackKey(track: MovementTrack): string {
  const id =
    track.callsign?.trim() || track.registration?.trim() || track.trackId;
  return `${track.targetType}:${id}`;
}

export function resolveTrackHistoryKey(record: TrackHistoryRecord): string {
  const id =
    record.callsign?.trim() || record.registration?.trim() || record.trackId;
  return `${record.targetType}:${id}`;
}

export function getTrackKey(trackId: string): string | undefined {
  return trackIdToKey.get(trackId);
}

export interface EntityKeyInput {
  trackId: string;
  relatedTrackId?: string | null;
  aerodromeFeatureId?: string | null;
}

/** Bangun entity key yang stabil untuk Redis active-alert cache.
 *  TrackId berubah tiap update, jadi kita pakai stable key (callsign/registration).
 *  Key format: `targetType:callsign[|related][|aerodromeFeatureId]` */
export function buildEntityKey(input: EntityKeyInput): string {
  const main = getTrackKey(input.trackId) ?? input.trackId;
  const related = input.relatedTrackId
    ? (getTrackKey(input.relatedTrackId) ?? input.relatedTrackId)
    : null;
  if (input.aerodromeFeatureId) {
    return `${main}|${input.aerodromeFeatureId}`;
  }
  if (related) {
    return `${main}|${related}`;
  }
  return main;
}

export function pushTrackHistory(track: MovementTrack): void {
  const key = resolveTrackKey(track);
  trackIdToKey.set(track.trackId, key);

  // Bila track ini sebelumnya sudah masuk dengan trackId berbeda namun
  // callsign/registration sama, gabungkan riwayatnya.
  const existing = history.get(key) ?? [];

  // Hindari duplikat berurutan di timestamp sama.
  const last = existing[existing.length - 1];
  if (
    last &&
    last.timestamp.getTime() === track.timestamp.getTime() &&
    last.latitude === track.latitude &&
    last.longitude === track.longitude
  ) {
    return;
  }

  // Hanya laporan yang masuk akal sebagai kelanjutan titik sebelumnya: satu jalur yang konsisten, bukan campuran semua sensor.
  let gate = gates.get(key);
  if (!gate) {
    gate = newGateState();
    gates.set(key, gate);
  }
  if (!admit(last ? gatePoint(last) : undefined, gatePoint(track), gate))
    return;

  const next = purgeOld([...existing, track]);
  history.set(key, next);
}

function toHistoryRecord(track: MovementTrack): TrackHistoryRecord {
  return {
    trackId: track.trackId,
    callsign: track.callsign,
    registration: track.registration,
    targetType: track.targetType,
    latitude: track.latitude,
    longitude: track.longitude,
    altitude: track.altitude ?? null,
    groundSpeed: track.groundSpeed ?? null,
    heading: track.heading ?? null,
    onGround: track.onGround ?? null,
    timestamp: track.timestamp.toISOString(),
  };
}

export function getTrackHistory(
  trackId: string | null | undefined,
  limit = HISTORY_LIMIT,
): TrackHistoryRecord[] {
  if (!trackId) return [];
  const key = trackIdToKey.get(trackId) ?? trackId;
  const entries = (history.get(key) ?? []).slice(-limit);
  return entries.map(toHistoryRecord);
}
