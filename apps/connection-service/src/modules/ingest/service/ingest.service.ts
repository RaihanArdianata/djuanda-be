import { aeroswarmAlerts, aeroswarmTracks, db } from "@repo/database";
import { logger } from "@repo/logger";

type TrackRow = typeof aeroswarmTracks.$inferInsert;
type AlertRow = typeof aeroswarmAlerts.$inferInsert;

const FLUSH_INTERVAL_MS = 500;
const MAX_BUFFER = 500;
const INGEST_SECRET = process.env.AEROSWARM_INGEST_SECRET || "";

export function isValidIngestSecret(secret: string | null | undefined): boolean {
  return Boolean(INGEST_SECRET) && secret === INGEST_SECRET;
}

const trackBuffer: TrackRow[] = [];
const alertBuffer: AlertRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

interface FusedTrackEventLike {
  trackId: string;
  airportId?: string;
  lifecycle?: string;
  fusedAt: number;
  [key: string]: unknown;
}

interface AlertEventLike {
  alertId: string;
  airportId?: string;
  type?: string;
  severity?: string;
  trackId?: string;
  triggeredAt: number;
  [key: string]: unknown;
}

export function isTrackEvent(event: unknown): event is FusedTrackEventLike {
  const e = event as Record<string, unknown> | null;
  return typeof e?.trackId === "string" && typeof e?.fusedAt === "number";
}

export function isAlertEvent(event: unknown): event is AlertEventLike {
  const e = event as Record<string, unknown> | null;
  return typeof e?.alertId === "string" && typeof e?.triggeredAt === "number";
}

export function enqueueTrackEvent(event: FusedTrackEventLike): void {
  trackBuffer.push({
    fusedAt: new Date(event.fusedAt),
    trackId: event.trackId,
    airportId: event.airportId ?? null,
    lifecycle: event.lifecycle ?? null,
    data: event,
  });
  scheduleFlush();
}

export function enqueueAlertEvent(event: AlertEventLike): void {
  alertBuffer.push({
    triggeredAt: new Date(event.triggeredAt),
    alertId: event.alertId,
    airportId: event.airportId ?? null,
    type: event.type ?? null,
    severity: event.severity ?? null,
    trackId: event.trackId ?? null,
    data: event,
  });
  scheduleFlush();
}

function scheduleFlush(): void {
  if (trackBuffer.length + alertBuffer.length >= MAX_BUFFER) {
    void flush();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
}

export async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const tracks = trackBuffer.splice(0);
  const alerts = alertBuffer.splice(0);
  if (tracks.length === 0 && alerts.length === 0) return;

  try {
    if (tracks.length) await db.insert(aeroswarmTracks).values(tracks);
    if (alerts.length) await db.insert(aeroswarmAlerts).values(alerts);
  } catch (error) {
    // Rows are dropped rather than requeued — AeroSwarm's connector layer
    // already retries failed deliveries and dead-letters them, so replaying
    // the same rows here would double-count. Log loudly instead.
    logger.error(
      { err: error, tracks: tracks.length, alerts: alerts.length },
      "aeroswarm ingest flush failed — rows dropped (connector-side retry/DLQ will re-deliver)",
    );
  }
}
