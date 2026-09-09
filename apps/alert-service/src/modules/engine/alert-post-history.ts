import type { TrackHistoryRecord } from "./track-history";
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

export function startPostHistory(
  alertId: string,
  mainTrackId?: string | null,
  relatedTrackId?: string | null,
): void {
  postHistoryMain.set(alertId, []);
  if (relatedTrackId) postHistoryRelated.set(alertId, []);

  const refs: AlertTrackRefs = {
    main: mainTrackId ?? undefined,
    related: relatedTrackId ?? undefined,
  };
  alertTracks.set(alertId, refs);

  for (const trackId of [refs.main, refs.related].filter(Boolean) as string[]) {
    if (!trackToAlerts.has(trackId)) trackToAlerts.set(trackId, new Set());
    trackToAlerts.get(trackId)?.add(alertId);
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

  if (track.trackId === refs.main) {
    const list = postHistoryMain.get(alertId);
    if (!list) return undefined;
    const last = list[list.length - 1];
    if (last && isSamePoint(last, record)) return undefined;
    list.push(record);
    return { alertId, kind: "main", record };
  }

  if (track.trackId === refs.related) {
    const list = postHistoryRelated.get(alertId);
    if (!list) return undefined;
    const last = list[list.length - 1];
    if (last && isSamePoint(last, record)) return undefined;
    list.push(record);
    return { alertId, kind: "related", record };
  }

  return undefined;
}

export function getActiveAlertIdsForTrack(trackId: string): string[] {
  return [...(trackToAlerts.get(trackId) ?? [])];
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
    for (const trackId of [refs.main, refs.related].filter(
      Boolean,
    ) as string[]) {
      const set = trackToAlerts.get(trackId);
      if (set) {
        set.delete(alertId);
        if (set.size === 0) trackToAlerts.delete(trackId);
      }
    }
  }
  alertTracks.delete(alertId);

  return { main, related };
}
