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

const history = new Map<string, MovementTrack[]>();

function purgeOld(entries: MovementTrack[]): MovementTrack[] {
  const now = Date.now();
  // Hapus entri yang lebih tua dari EXPIRY_MS; batasi ke HISTORY_LIMIT terakhir.
  const fresh = entries.filter((e) => now - e.timestamp.getTime() < EXPIRY_MS);
  return fresh.slice(-HISTORY_LIMIT);
}

export function pushTrackHistory(track: MovementTrack): void {
  const existing = history.get(track.trackId) ?? [];
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
  history.set(track.trackId, next);
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
  const entries = (history.get(trackId) ?? []).slice(-limit);
  return entries.map(toHistoryRecord);
}
