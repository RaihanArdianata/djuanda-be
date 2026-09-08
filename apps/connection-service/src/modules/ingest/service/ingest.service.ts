import {
  type AeroswarmMovement,
  aeroswarmAlerts,
  aeroswarmMovements,
  aeroswarmTracks,
  db,
} from "@repo/database";
import { logger } from "@repo/logger";
import { publishToTopic } from "@repo/shared/sse/publisher";
import { sql } from "drizzle-orm";
import { buildMovementId } from "../lib/movement-id";
import { publishTrackBatch } from "./track.producer";

type TrackRow = typeof aeroswarmTracks.$inferInsert;
type AlertRow = typeof aeroswarmAlerts.$inferInsert;
type MovementRow = typeof aeroswarmMovements.$inferInsert;
const DB_TO_API_MOVEMENT_TYPE = {
  takeoff: "TAKE_OFF",
  landing: "LANDING",
} as const;

async function publishMovementEvent(row: AeroswarmMovement): Promise<void> {
  logger.info(
    { trackId: row.trackId, type: row.type, airportId: row.airportId },
    "publishMovementEvent: called",
  );

  if (row.type !== "takeoff" && row.type !== "landing") {
    logger.info(
      { trackId: row.trackId, type: row.type },
      "publishMovementEvent: skipped, invalid type",
    );
    return;
  }
  if (!row.airportId) {
    logger.info(
      { trackId: row.trackId },
      "publishMovementEvent: skipped, no airportId",
    );
    return;
  }

  const topic =
    row.type === "takeoff" ? "movement.takeoff" : "movement.landing";

  logger.info(
    { topic, trackId: row.trackId },
    "publishMovementEvent: publishing to redis",
  );

  await publishToTopic(topic, {
    id: buildMovementId(row.trackId, row.type, row.at),
    type: topic,
    timestamp: new Date().toISOString(),
    data: {
      id: buildMovementId(row.trackId, row.type, row.at),
      trackId: row.trackId,
      ...(row.callsign ? { callsign: row.callsign } : {}),
      ...(row.icao24 ? { icao24: row.icao24 } : {}),
      airportId: row.airportId,
      type: DB_TO_API_MOVEMENT_TYPE[row.type],
      eventTime: row.at.toISOString(),
    },
  });

  logger.info(
    { topic, trackId: row.trackId },
    "publishMovementEvent: publish done",
  );
}

const FLUSH_INTERVAL_MS = 500;
const MAX_BUFFER = 500;
const INGEST_SECRET: string = process.env.AEROSWARM_INGEST_SECRET || "";

const INGEST_LOG_MAX = 200;

export interface IngestLogEntry {
  timestamp: string;
  source: "http" | "kafka";
  kind: "track" | "alert" | "movement" | "unknown";
  status: "accepted" | "rejected" | "error";
  id?: string;
  airportId?: string;
  message?: string;
}

const ingestLog: IngestLogEntry[] = [];

export function isValidIngestSecret(
  secret: string | null | undefined,
): boolean {
  return Boolean(INGEST_SECRET) && secret === INGEST_SECRET;
}

const EXPECTED_AIRPORT_ID: string = process.env.AEROSWARM_AIRPORT_ID || "";
if (!EXPECTED_AIRPORT_ID) {
  logger.warn(
    "AEROSWARM_AIRPORT_ID is not set — ingest will accept events for ANY airportId with no validation. Set it to this deployment's ICAO code (e.g. WARR).",
  );
}

export class AirportMismatchError extends Error {
  constructor(gotAirportId: string | undefined) {
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
const movementBuffer: MovementRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

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
  identity?: {
    targetType?: string;
    vehicleFleet?: number;
    [key: string]: unknown;
  };
  position?: {
    alt?: number;
    onGround?: boolean;
    [key: string]: unknown;
  };
  velocity?: {
    groundSpeed?: number;
    [key: string]: unknown;
  };
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

interface MovementEventLike {
  trackId: string;
  type: "takeoff" | "landing";
  at: number;
  airportId?: string;
  icao24?: string;
  callsign?: string;
  lat: number;
  lon: number;
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

export function isMovementEvent(event: unknown): event is MovementEventLike {
  const e = event as Record<string, unknown> | null;
  return (
    typeof e?.trackId === "string" &&
    (e?.type === "takeoff" || e?.type === "landing") &&
    typeof e?.at === "number"
  );
}

export function getIngestEventIdentity(event: unknown): {
  id?: string;
  airportId?: string;
} {
  if (!event || typeof event !== "object") return {};
  const e = event as Record<string, unknown>;
  return {
    id: (e.trackId as string | undefined) ?? (e.alertId as string | undefined),
    airportId: e.airportId as string | undefined,
  };
}

export function getIngestLogKind(event: unknown): IngestLogEntry["kind"] {
  if (isTrackEvent(event)) return "track";
  if (isAlertEvent(event)) return "alert";
  if (isMovementEvent(event)) return "movement";
  return "unknown";
}

export function enqueueTrackEvent(event: FusedTrackEventLike): Promise<void> {
  trackBuffer.push({
    fusedAt: new Date(event.fusedAt),
    trackId: event.trackId,
    airportId: event.airportId ?? null,
    lifecycle: event.lifecycle ?? null,
    targetType: event.identity?.targetType ?? null,
    vehicleFleet: event.identity?.vehicleFleet ?? null,
    altitudeFt: event.position?.alt ?? null,
    groundSpeedKt: event.velocity?.groundSpeed ?? null,
    onGround: event.position?.onGround ?? null,
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

export function enqueueMovementEvent(event: MovementEventLike): Promise<void> {
  movementBuffer.push({
    id: (event.id as string | undefined) ?? null,
    airportId: event.airportId ?? null,
    trackId: event.trackId,
    icao24: event.icao24 ?? null,
    callsign: event.callsign ?? null,
    type: event.type,
    lat: event.lat,
    lon: event.lon,
    at: new Date(event.at),
    data: event,
  });
  return scheduleFlush();
}

export async function enqueueIngestEvent(event: unknown): Promise<void> {
  const kind = getIngestLogKind(event);
  if (kind === "track") {
    await enqueueTrackEvent(event as FusedTrackEventLike);
    return;
  }
  if (kind === "alert") {
    await enqueueAlertEvent(event as AlertEventLike);
    return;
  }
  if (kind === "movement") {
    await enqueueMovementEvent(event as MovementEventLike);
    return;
  }
}

function scheduleFlush(): Promise<void> {
  const batch = getOrCreateBatch();
  if (
    trackBuffer.length + alertBuffer.length + movementBuffer.length >=
    MAX_BUFFER
  ) {
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
  const movements = movementBuffer.splice(0);
  const batch = currentBatch;
  currentBatch = null;

  if (tracks.length === 0 && alerts.length === 0 && movements.length === 0) {
    batch?.resolve();
    return;
  }

  try {
    if (tracks.length) {
      await db.insert(aeroswarmTracks).values(tracks).onConflictDoNothing();
      try {
        await publishTrackBatch(tracks.map((row) => row.data));
      } catch (err) {
        logger.error(
          { err, tracks: tracks.length },
          "track publish to asmgcs.tracks failed — tracks persisted, alert pipeline missed them",
        );
      }
    }
    if (alerts.length)
      await db.insert(aeroswarmAlerts).values(alerts).onConflictDoNothing();
    if (movements.length) {
      const upsertedMovements = await db
        .insert(aeroswarmMovements)
        .values(movements)
        .onConflictDoUpdate({
          target: [
            aeroswarmMovements.trackId,
            aeroswarmMovements.type,
            aeroswarmMovements.at,
          ],
          set: { data: sql`excluded.data` },
        })
        .returning();

      const results = await Promise.allSettled(
        upsertedMovements.map((row) => publishMovementEvent(row)),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const row = upsertedMovements[index] as AeroswarmMovement;
          logger.error(
            { err: result.reason, trackId: row.trackId, type: row.type },
            "movement SSE publish failed — movement is persisted, event was not broadcast",
          );
        }
      });
    }
    batch?.resolve();
  } catch (error) {
    logger.error(
      {
        err: error,
        tracks: tracks.length,
        alerts: alerts.length,
        movements: movements.length,
      },
      "aeroswarm ingest flush failed — event not durably persisted, caller will see a 5xx",
    );
    batch?.reject(error);
  }
}

export function recordIngestLog(
  entry: Omit<IngestLogEntry, "timestamp">,
): void {
  const item: IngestLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  ingestLog.unshift(item);
  while (ingestLog.length > INGEST_LOG_MAX) {
    ingestLog.pop();
  }
}

export function getIngestLog(limit = 100): IngestLogEntry[] {
  return ingestLog.slice(0, Math.max(1, limit));
}
