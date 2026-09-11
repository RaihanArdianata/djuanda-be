import {
  getTrackKey,
  resolveTrackKey,
  type TrackHistoryRecord,
} from "./track-history";
import type { MovementTrack } from "./types";

interface AlertTrackRefs {
  main?: string;
  related?: string;
}

const postHistoryMain = new Map<string, TrackHistoryRecord[]>();
const postHistoryRelated = new Map<string, TrackHistoryRecord[]>();
const alertTracks = new Map<string, AlertTrackRefs>();
const trackToAlerts = new Map<string, Set<string>>();

function toRecord(track: MovementTrack): TrackHistoryRecord {
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

function stableKeyFor(trackId?: string | null): string | undefined {
  if (!trackId) return undefined;
  return getTrackKey(trackId) ?? trackId;
}

export function startPostHistory(
  alertId: string,
  mainTrackId?: string | null,
  relatedTrackId?: string | null,
): void {
  postHistoryMain.set(alertId, []);
  if (relatedTrackId) postHistoryRelated.set(alertId, []);

  const refs: AlertTrackRefs = {
    main: stableKeyFor(mainTrackId),
    related: stableKeyFor(relatedTrackId),
  };
  alertTracks.set(alertId, refs);

  for (const key of [refs.main, refs.related].filter(Boolean) as string[]) {
    if (!trackToAlerts.has(key)) trackToAlerts.set(key, new Set());
    trackToAlerts.get(key)?.add(alertId);
  }
}

export function seedPostHistory(
  alertId: string,
  main?: TrackHistoryRecord,
  related?: TrackHistoryRecord,
): void {
  if (main) postHistoryMain.set(alertId, [main]);
  if (related) postHistoryRelated.set(alertId, [related]);
}

export interface PostHistoryAppendResult {
  alertId: string;
  kind: "main" | "related";
  record: TrackHistoryRecord;
}

function isSamePoint(a: TrackHistoryRecord, b: TrackHistoryRecord): boolean {
  return (
    a.timestamp === b.timestamp &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude
  );
}

export function appendPostHistory(
  alertId: string,
  track: MovementTrack,
): PostHistoryAppendResult | undefined {
  const refs = alertTracks.get(alertId);
  if (!refs) return undefined;

  const record = toRecord(track);
  const key = resolveTrackKey(track);

  if (refs.main && key === refs.main) {
    const list = postHistoryMain.get(alertId);
    if (!list) return undefined;
    const last = list[list.length - 1];
    if (last && isSamePoint(last, record)) return undefined;
    list.push(record);
    return { alertId, kind: "main", record };
  }

  if (refs.related && key === refs.related) {
    const list = postHistoryRelated.get(alertId);
    if (!list) return undefined;
    const last = list[list.length - 1];
    if (last && isSamePoint(last, record)) return undefined;
    list.push(record);
    return { alertId, kind: "related", record };
  }

  return undefined;
}

export function getActiveAlertIdsForMovementTrack(
  track: MovementTrack,
): string[] {
  const key = resolveTrackKey(track);
  return [...(trackToAlerts.get(key) ?? [])];
}

export function flushPostHistory(alertId: string): {
  main: TrackHistoryRecord[];
  related: TrackHistoryRecord[];
} {
  const main = postHistoryMain.get(alertId) ?? [];
  const related = postHistoryRelated.get(alertId) ?? [];

  postHistoryMain.delete(alertId);
  postHistoryRelated.delete(alertId);

  const refs = alertTracks.get(alertId);
  if (refs) {
    for (const key of [refs.main, refs.related].filter(Boolean) as string[]) {
      const set = trackToAlerts.get(key);
      if (set) {
        set.delete(alertId);
        if (set.size === 0) trackToAlerts.delete(key);
      }
    }
  }
  alertTracks.delete(alertId);

  return { main, related };
}
