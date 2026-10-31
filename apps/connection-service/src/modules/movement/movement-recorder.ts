import type { FusedTrackEvent } from "@aeroswarm/core";
import {
  createMovementDetector,
  type MovementDetector,
  type MovementEvent,
  type MovementSample,
} from "@aeroswarm/live-server";

/** Forget phase state for tracks silent this long (same as AeroSwarm's recorder). */
const STATE_TTL_MS = 10 * 60_000;
const SWEEP_MS = 60_000;

/** Shape the ingest buffer stores: optional strings instead of nulls. */
// A type alias, not an interface: it must satisfy the ingest buffer's index-signature shape.
export type MovementIngestEvent = {
  trackId: string;
  type: "takeoff" | "landing";
  at: number;
  airportId?: string;
  icao24?: string;
  callsign?: string;
  lat: number;
  lon: number;
};

export function toMovementIngestEvent(
  event: MovementEvent,
): MovementIngestEvent {
  return {
    trackId: event.trackId,
    type: event.type,
    at: event.at,
    ...(event.airportId ? { airportId: event.airportId } : {}),
    ...(event.icao24 ? { icao24: event.icao24 } : {}),
    ...(event.callsign ? { callsign: event.callsign } : {}),
    lat: event.lat,
    lon: event.lon,
  };
}

export interface MovementRecorderStats {
  evaluated: number;
  movementsDetected: number;
}

export interface MovementRecorder {
  /** Feed one fused track; calls `onMovement` when it completes a takeoff or landing. */
  evaluate(fused: FusedTrackEvent): void;
  /** Drop phase state for a removed track. */
  forget(trackId: string): void;
  /** Forget tracks silent for too long. */
  sweep(now?: number): void;
  startSweep(): void;
  stop(): void;
  readonly stats: MovementRecorderStats;
}

/** The detector's input for a fused track, or null when it must not be evaluated
 *  (no position, or a surface vehicle). Mirrors AeroSwarm's recorder. */
function toSample(fused: FusedTrackEvent): MovementSample | null {
  const lat = fused.position?.lat;
  const lon = fused.position?.lon;
  if (lat == null || lon == null) return null;
  if (fused.identity?.targetType === "vehicle") return null;
  return {
    trackId: fused.trackId,
    icao24: fused.identity?.icao24 ?? null,
    callsign: fused.identity?.callsign ?? null,
    ...(fused.airportId ? { airportId: fused.airportId } : {}),
    at: fused.updatedAt || Date.now(),
    lat,
    lon,
    altitudeFt: fused.position?.alt ?? null,
    groundSpeedKt: fused.velocity?.groundSpeed ?? null,
    ...(fused.position?.onGround !== undefined
      ? { onGround: fused.position.onGround }
      : {}),
  };
}

/**
 * Detects takeoffs and landings from the fused track stream, with the same
 * inputs and exclusions as AeroSwarm's own recorder so results can be compared
 * one-to-one: `dropped` events and tracks without a position are ignored, and
 * so are surface vehicles.
 *
 * Detection is the package's `MovementDetector` (hysteresis on altitude and
 * ground speed, 120 s debounce). Persistence is the caller's `onMovement`.
 */
export function createMovementRecorder(opts: {
  onMovement: (event: MovementEvent) => void;
  detector?: MovementDetector;
}): MovementRecorder {
  const detector = opts.detector ?? createMovementDetector();
  const stats: MovementRecorderStats = { evaluated: 0, movementsDetected: 0 };
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    stats,
    evaluate(fused: FusedTrackEvent): void {
      if (fused.lifecycle === "dropped") {
        detector.forget(fused.trackId);
        return;
      }
      const sample = toSample(fused);
      if (!sample) return;
      stats.evaluated++;
      const event = detector.update(sample);
      if (!event) return;
      stats.movementsDetected++;
      opts.onMovement(event);
    },
    forget(trackId: string): void {
      detector.forget(trackId);
    },
    sweep(now?: number): void {
      detector.sweep(STATE_TTL_MS, now);
    },
    startSweep(): void {
      if (timer) return;
      timer = setInterval(() => detector.sweep(STATE_TTL_MS), SWEEP_MS);
      timer.unref?.();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
