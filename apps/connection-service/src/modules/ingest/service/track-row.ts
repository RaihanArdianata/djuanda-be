import type { aeroswarmTracks } from "@repo/database";
import { withoutAsterixItems } from "../../feed/strip-asterix-items";

export type TrackRow = typeof aeroswarmTracks.$inferInsert;

/** The parts of a fused track event the row is made from. The whole event is also kept, as jsonb. */
export interface TrackRowSource {
  trackId: string;
  airportId?: string;
  lifecycle?: string;
  fusedAt: number;
  protocol?: string;
  dataSource?: { sac: number; sic: number };
  identity?: {
    icao24?: string;
    callsign?: string;
    targetType?: string;
    vehicleFleet?: number;
    aircraftType?: string;
  };
  position?: { lat?: number; lon?: number; alt?: number; onGround?: boolean };
  velocity?: { groundSpeed?: number };
  details?: { trackNumber?: number };
}

const text = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;

/**
 * One row of `aeroswarm_tracks`. The columns are the facts people filter and group by (who, what type, where, which
 * sensor); the rest of the event stays in `data`. Absent means NULL, never a made-up 0 or empty string.
 */
export function toTrackRow(event: TrackRowSource): TrackRow {
  return {
    fusedAt: new Date(event.fusedAt),
    trackId: event.trackId,
    airportId: event.airportId ?? null,
    lifecycle: event.lifecycle ?? null,
    targetType: event.identity?.targetType ?? null,
    vehicleFleet: event.identity?.vehicleFleet ?? null,
    altitudeFt: event.position?.alt ?? null,
    groundSpeedKt: event.velocity?.groundSpeed ?? null,
    onGround: event.position?.onGround ?? null,
    icao24: text(event.identity?.icao24),
    callsign: text(event.identity?.callsign),
    aircraftType: text(event.identity?.aircraftType),
    lat: event.position?.lat ?? null,
    lon: event.position?.lon ?? null,
    trackNumber: event.details?.trackNumber ?? null,
    protocol: text(event.protocol),
    sac: event.dataSource?.sac ?? null,
    sic: event.dataSource?.sic ?? null,
    data: withoutAsterixItems(event),
  };
}
