import { aeroswarmAlerts, aeroswarmTracks, db } from "@repo/database";
import { logger } from "@repo/logger";

type TrackRow = typeof aeroswarmTracks.$inferInsert;
type AlertRow = typeof aeroswarmAlerts.$inferInsert;

const FLUSH_INTERVAL_MS = 500;
const MAX_BUFFER = 500;
const INGEST_SECRET = process.env.AEROSWARM_INGEST_SECRET || "";

export function isValidIngestSecret(
  secret: string | null | undefined,
): boolean {
  return Boolean(INGEST_SECRET) && secret === INGEST_SECRET;
}

// Same deployment identity used to scope outbound history/replay queries
// (see history.service.ts / docs/audit/tasks/006-*.md) — reused here so an
// inbound event actually belongs to this airport before it's persisted.
// The ingest secret/monitor tokens only prove "this sender is a legitimate
// AeroSwarm instance", never "this specific event is ours" — a
// misconfigured second-airport connector, or a broker/topic pointed at the
// wrong place, would otherwise be silently ingested with no rejection. See
// docs/audit/tasks/007-*.md.
const EXPECTED_AIRPORT_ID = process.env.AEROSWARM_AIRPORT_ID || "";
if (!EXPECTED_AIRPORT_ID) {
  logger.warn(
    "AEROSWARM_AIRPORT_ID is not set — ingest will accept events for ANY airportId with no validation. Set it to this deployment's ICAO code (e.g. WARR).",
  );
}

export class AirportMismatchError extends Error {
  constructor(public readonly gotAirportId: string | undefined) {
    super(
      `event airportId "${gotAirportId ?? ""}" does not match this deployment's AEROSWARM_AIRPORT_ID "${EXPECTED_AIRPORT_ID}"`,
    );
    this.name = "AirportMismatchError";
  }
}

/** Throws AirportMismatchError when the event's airportId doesn't match
 *  this deployment's configured identity. No-ops (accepts anything) if
 *  AEROSWARM_AIRPORT_ID isn't configured — same soft-fail-with-warning
 *  posture as Task 006's history-side scoping, so an unconfigured dev
 *  environment doesn't hard-fail ingest outright. */
export function assertExpectedAirport(event: { airportId?: string }): void {
  if (!EXPECTED_AIRPORT_ID) return;
  if (event.airportId !== EXPECTED_AIRPORT_ID) {
    throw new AirportMismatchError(event.airportId);
  }
}

const trackBuffer: TrackRow[] = [];
const alertBuffer: AlertRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// The batch currently accumulating in trackBuffer/alertBuffer shares one
// promise, settled by flush() right before/after the DB write. Callers
// (enqueueTrackEvent/enqueueAlertEvent) await it so the HTTP response isn't
// sent until the event is actually durable — a flush failure rejects it,
// which the controller turns into a 5xx so AeroSwarm's sender retries
// instead of believing delivery already succeeded.
interface Batch {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

let currentBatch: Batch | null = null;

function getOrCreateBatch(): Batch {
  if (!currentBatch) {
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    currentBatch = { promise, resolve, reject };
  }
  return currentBatch;
}

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

export function enqueueTrackEvent(event: FusedTrackEventLike): Promise<void> {
  trackBuffer.push({
    fusedAt: new Date(event.fusedAt),
    trackId: event.trackId,
    airportId: event.airportId ?? null,
    lifecycle: event.lifecycle ?? null,
    data: event,
  });
  return scheduleFlush();
}

export function enqueueAlertEvent(event: AlertEventLike): Promise<void> {
  alertBuffer.push({
    triggeredAt: new Date(event.triggeredAt),
    alertId: event.alertId,
    airportId: event.airportId ?? null,
    type: event.type ?? null,
    severity: event.severity ?? null,
    trackId: event.trackId ?? null,
    data: event,
  });
  return scheduleFlush();
}

function scheduleFlush(): Promise<void> {
  const batch = getOrCreateBatch();
  if (trackBuffer.length + alertBuffer.length >= MAX_BUFFER) {
    void flush();
    return batch.promise;
  }
  if (flushTimer) return batch.promise;
  flushTimer = setTimeout(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  return batch.promise;
}

export async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const tracks = trackBuffer.splice(0);
  const alerts = alertBuffer.splice(0);
  // Detach this batch's settlers before any await — enqueues that happen
  // during the DB write below (or after) belong to a fresh batch, not this
  // one, since getOrCreateBatch() will see currentBatch === null again.
  const batch = currentBatch;
  currentBatch = null;

  if (tracks.length === 0 && alerts.length === 0) {
    batch?.resolve();
    return;
  }

  try {
    // onConflictDoNothing backs the (track_id, fused_at) / (alert_id,
    // triggered_at) unique constraints — AeroSwarm's connector-side retry
    // (sendWithRetry wrapping WebhookSink's own retry, up to 9 POSTs worst
    // case for one event) can re-deliver an already-durably-written event
    // after a lost ack; without this, that re-delivery becomes a duplicate
    // row instead of a no-op. See docs/audit task 005.
    if (tracks.length)
      await db.insert(aeroswarmTracks).values(tracks).onConflictDoNothing();
    if (alerts.length)
      await db.insert(aeroswarmAlerts).values(alerts).onConflictDoNothing();
    batch?.resolve();
  } catch (error) {
    // Not dropped silently anymore — enqueueTrackEvent/enqueueAlertEvent's
    // callers (the ingest controller) await this batch's promise, so a
    // rejection here surfaces as a 5xx to the sender, which AeroSwarm's
    // connector-side retry/DLQ machinery will actually see and act on.
    logger.error(
      { err: error, tracks: tracks.length, alerts: alerts.length },
      "aeroswarm ingest flush failed — event not durably persisted, caller will see a 5xx",
    );
    batch?.reject(error);
  }
}
