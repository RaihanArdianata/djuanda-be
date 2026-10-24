import {
  aeroswarmMovements,
  aeroswarmTracks,
  db,
  weatherForecasts,
  weatherObservations,
} from "@repo/database";
import { and, eq, gte, lte } from "drizzle-orm";
import type { TimelineEvent } from "../schema/playback.schema";
import { buildDummyEvents } from "./dummy-data.service";

/**
 * Weather station id is assumed to equal the airport ICAO id (e.g. "WARR"),
 * matching how the sample rows are keyed.
 */
export async function loadTimeline(
  airportId: string,
  from: Date,
  to: Date,
  includeDummy = true,
): Promise<TimelineEvent[]> {
  const [tracks, movements, metars, tafs] = await Promise.all([
    loadAircraftTracks(airportId, from, to),
    loadAircraftMovements(airportId, from, to),
    loadMetars(airportId, from, to),
    loadTafs(airportId, from, to),
  ]);

  const dummy = includeDummy
    ? buildDummyEvents(airportId, from.getTime(), to.getTime())
    : [];

  const timeline = [...tracks, ...movements, ...metars, ...tafs, ...dummy];
  timeline.sort((a, b) => a.ts - b.ts);
  return timeline;
}

async function loadAircraftTracks(
  airportId: string,
  from: Date,
  to: Date,
): Promise<TimelineEvent[]> {
  const rows = await db
    .select()
    .from(aeroswarmTracks)
    .where(
      and(
        eq(aeroswarmTracks.airportId, airportId),
        gte(aeroswarmTracks.fusedAt, from),
        lte(aeroswarmTracks.fusedAt, to),
      ),
    );

  return rows.map((row) => ({
    type: "aircraft_track" as const,
    ts: row.fusedAt.getTime(),
    timestamp: row.fusedAt.toISOString(),
    data: {
      trackId: row.trackId,
      airportId: row.airportId,
      lifecycle: row.lifecycle,
      targetType: row.targetType,
      vehicleFleet: row.vehicleFleet,
      altitudeFt: row.altitudeFt,
      groundSpeedKt: row.groundSpeedKt,
      onGround: row.onGround,
      raw: row.data,
    },
  }));
}

async function loadAircraftMovements(
  airportId: string,
  from: Date,
  to: Date,
): Promise<TimelineEvent[]> {
  const rows = await db
    .select()
    .from(aeroswarmMovements)
    .where(
      and(
        eq(aeroswarmMovements.airportId, airportId),
        gte(aeroswarmMovements.at, from),
        lte(aeroswarmMovements.at, to),
      ),
    );

  return rows.map((row) => ({
    type: "aircraft_movement" as const,
    ts: row.at.getTime(),
    timestamp: row.at.toISOString(),
    data: {
      trackId: row.trackId,
      airportId: row.airportId,
      icao24: row.icao24,
      callsign: row.callsign,
      movementType: row.type,
      lat: row.lat,
      lon: row.lon,
      raw: row.data,
    },
  }));
}

async function loadMetars(
  station: string,
  from: Date,
  to: Date,
): Promise<TimelineEvent[]> {
  const rows = await db
    .select()
    .from(weatherObservations)
    .where(
      and(
        eq(weatherObservations.station, station),
        eq(weatherObservations.kind, "METAR"),
        gte(weatherObservations.observedAt, from),
        lte(weatherObservations.observedAt, to),
      ),
    );

  return rows.map((row) => ({
    type: "weather_metar" as const,
    ts: row.observedAt.getTime(),
    timestamp: row.observedAt.toISOString(),
    data: {
      station: row.station,
      raw: row.raw,
      parsed: row.parsed,
      source: row.source,
    },
  }));
}

async function loadTafs(
  station: string,
  from: Date,
  to: Date,
): Promise<TimelineEvent[]> {
  const rows = await db
    .select()
    .from(weatherForecasts)
    .where(
      and(
        eq(weatherForecasts.station, station),
        gte(weatherForecasts.issuedAt, from),
        lte(weatherForecasts.issuedAt, to),
      ),
    );

  return rows.map((row) => ({
    type: "weather_taf" as const,
    ts: row.issuedAt.getTime(),
    timestamp: row.issuedAt.toISOString(),
    data: {
      station: row.station,
      validFrom: row.validFrom.toISOString(),
      validTo: row.validTo.toISOString(),
      raw: row.raw,
      parsed: row.parsed,
      source: row.source,
    },
  }));
}
