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

function purgeOld(entries: MovementTrack[]): MovementTrack[] {
  const now = Date.now();
  // Hapus entri yang lebih tua dari EXPIRY_MS; batasi ke HISTORY_LIMIT terakhir.
  const fresh = entries.filter((e) => now - e.timestamp.getTime() < EXPIRY_MS);
  return fresh.slice(-HISTORY_LIMIT);
}

export function resolveTrackKey(track: MovementTrack): string {
  const id =
    (track.callsign && track.callsign.trim()) ||
    (track.registration && track.registration.trim()) ||
    track.trackId;
  return `${track.targetType}:${id}`;
}

export function resolveTrackHistoryKey(record: TrackHistoryRecord): string {
  const id =
    (record.callsign && record.callsign.trim()) ||
    (record.registration && record.registration.trim()) ||
    record.trackId;
  return `${record.targetType}:${id}`;
}

export function getTrackKey(trackId: string): string | undefined {
  return trackIdToKey.get(trackId);
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
