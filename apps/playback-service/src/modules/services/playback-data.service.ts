import {
  type AftnMessage,
  type AshtamMessage,
  aerodromeFeatures,
  aeroswarmMovements,
  aeroswarmTracks,
  aftnMessages,
  ashtamMessages,
  db,
  type NotamMessage,
  notamMessages,
  weatherForecasts,
  weatherObservations,
} from "@repo/database";
import { and, eq, gte, inArray, lte, ne, or, type SQL } from "drizzle-orm";
import type { TimelineEvent } from "../schema/playback.schema";

const ASHTAM_MOCK_SOURCE = "ashtam-mock";

const AERODROME_SNAPSHOT_LAYERS: string[] = [
  "AERODROME",
  "RUNWAY",
  "TAXIWAY",
  "APRON",
  "RESTRICTED",
];

/**
 * Weather station id is assumed to equal the airport ICAO id (e.g. "WARR"),
 * matching how the sample rows are keyed.
 */
export async function loadTimeline(
  airportId: string,
  from: Date,
  to: Date,
): Promise<TimelineEvent[]> {
  const sources = await Promise.all([
    loadAircraftTracks(airportId, from, to),
    loadAircraftMovements(airportId, from, to),
    loadMetars(airportId, from, to),
    loadTafs(airportId, from, to),
    loadAftnMessages(airportId, from, to),
    loadNotams(airportId, from, to),
    loadAshtams(airportId, from, to),
    loadAerodromeSnapshot(airportId, from),
  ]);

  const timeline = sources.flat();
  timeline.sort((a, b) => a.ts - b.ts);
  return timeline;
}

// NOTAM and ASHTAM tables are unique per source, so one message synced from
// several providers is stored several times.
export function latestPerKey<T extends { updatedAt: Date }>(
  rows: T[],
  keyOf: (row: T) => string,
): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const kept = latest.get(key);
    if (!kept || row.updatedAt > kept.updatedAt) latest.set(key, row);
  }
  return [...latest.values()];
}

// A NOTAM or ASHTAM already in force when the window opens is shown at the
// start of playback instead of being dropped.
function validityStart(
  effectiveFrom: Date | null,
  fromMs: number,
): { ts: number; timestamp: string } {
  const ts = Math.max(effectiveFrom?.getTime() ?? fromMs, fromMs);
  return { ts, timestamp: new Date(ts).toISOString() };
}

// `status` is deliberately not filtered: it holds today's state, and a NOTAM
// cancelled since may have been in force during the recording.
export function notamWindowFilter(
  airportId: string,
  from: Date,
  to: Date,
): SQL | undefined {
  return and(
    eq(notamMessages.icaoLocation, airportId),
    lte(notamMessages.effectiveFrom, to),
    gte(notamMessages.effectiveTo, from),
  );
}

export function notamRowToEvent(
  row: NotamMessage,
  fromMs: number,
): TimelineEvent {
  return {
    type: "notam",
    ...validityStart(row.effectiveFrom, fromMs),
    data: {
      id: row.id,
      airportId: row.icaoLocation,
      source: row.source,
      header: row.header,
      series: row.series,
      number: row.number,
      year: row.year,
      type: row.type,
      fir: row.fir,
      qcode: row.qcode,
      traffic: row.traffic,
      purpose: row.purpose,
      scope: row.scope,
      lowerLimit: row.lowerLimit,
      upperLimit: row.upperLimit,
      coordinates: row.coordinates,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo.toISOString(),
      schedule: row.schedule,
      lowerAltitude: row.lowerAltitude,
      upperAltitude: row.upperAltitude,
      subject: row.subject,
      text: row.body,
      status: row.status,
      raw: row.raw,
    },
  };
}

async function loadNotams(
  airportId: string,
  from: Date,
  to: Date,
): Promise<TimelineEvent[]> {
  const rows = await db
    .select()
    .from(notamMessages)
    .where(notamWindowFilter(airportId, from, to));

  return latestPerKey(
    rows,
    (row) => `${row.series}/${row.number}/${row.year}`,
  ).map((row) => notamRowToEvent(row, from.getTime()));
}

// ashtam_messages is keyed by FIR, not airport, so every ASHTAM in the window
// is included and `affectedFir` travels with the event.
export function ashtamWindowFilter(from: Date, to: Date): SQL | undefined {
  return and(
    lte(ashtamMessages.effectiveFrom, to),
    gte(ashtamMessages.effectiveTo, from),
    ne(ashtamMessages.source, ASHTAM_MOCK_SOURCE),
  );
}

export function ashtamRowToEvent(
  row: AshtamMessage,
  airportId: string,
  fromMs: number,
): TimelineEvent {
  return {
    type: "ashtam",
    ...validityStart(row.effectiveFrom, fromMs),
    data: {
      id: row.id,
      airportId,
      source: row.source,
      number: row.number,
      header: row.header,
      affectedFir: row.affectedFir,
      effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
      volcano: row.volcanoName,
      volcanoCoordinates: row.volcanoCoordinates,
      colourCode: row.colourCode,
      ashAdvisory: row.volcanicAsh,
      volcanicAshDirection: row.volcanicAshDirection,
      airRoutesAffected: row.airRoutesAffected,
      airRoutesClosure: row.airRoutesClosure,
      informationSource: row.informationSource,
      remark: row.remark,
      status: row.status,
      raw: row.raw,
    },
  };
}

async function loadAshtams(
  airportId: string,
  from: Date,
  to: Date,
): Promise<TimelineEvent[]> {
  const rows = await db
    .select()
    .from(ashtamMessages)
    .where(ashtamWindowFilter(from, to));

  return latestPerKey(rows, (row) => row.providerId).map((row) =>
    ashtamRowToEvent(row, airportId, from.getTime()),
  );
}

export function aerodromeSnapshotFilter(airportId: string): SQL | undefined {
  return and(
    eq(aerodromeFeatures.airportId, airportId),
    inArray(aerodromeFeatures.layer, AERODROME_SNAPSHOT_LAYERS),
  );
}

// aerodrome_features keeps no history, so this is the current state, sent once
// at the start of the window.
export function aerodromeSnapshotEvents(
  rows: (typeof aerodromeFeatures.$inferSelect)[],
  airportId: string,
  fromMs: number,
): TimelineEvent[] {
  if (rows.length === 0) return [];
  return [
    {
      type: "aerodrome",
      ts: fromMs,
      timestamp: new Date(fromMs).toISOString(),
      data: {
        airportId,
        status: rows.find((row) => row.layer === "AERODROME")?.status ?? null,
        features: rows.map((row) => ({
          id: row.id,
          layer: row.layer,
          name: row.name,
          status: row.status,
          properties: row.properties,
          geometry: row.geometry,
        })),
      },
    },
  ];
}

async function loadAerodromeSnapshot(
  airportId: string,
  from: Date,
): Promise<TimelineEvent[]> {
  const rows = await db
    .select()
    .from(aerodromeFeatures)
    .where(aerodromeSnapshotFilter(airportId));

  return aerodromeSnapshotEvents(rows, airportId, from.getTime());
}

// aftn_messages has no airport column: a message belongs to the airport it
// departs from or arrives at.
export function aftnWindowFilter(
  airportId: string,
  from: Date,
  to: Date,
): SQL | undefined {
  return and(
    or(
      eq(aftnMessages.departure, airportId),
      eq(aftnMessages.destination, airportId),
    ),
    gte(aftnMessages.datetime, from),
    lte(aftnMessages.datetime, to),
  );
}

export function aftnRowToEvent(row: AftnMessage): TimelineEvent {
  return {
    type: "aftn",
    ts: row.datetime.getTime(),
    timestamp: row.datetime.toISOString(),
    data: {
      id: row.id,
      messageType: row.messageType,
      callSign: row.callSign,
      registration: row.registration,
      aircraftType: row.aircraftType,
      departure: row.departure,
      departureTime: row.departureTime,
      destination: row.destination,
      destinationTime: row.destinationTime,
      duration: row.duration,
      speed: row.speed,
      altitude: row.altitude,
      route: row.route,
      raw: row.raw,
      parsed: row.parsed,
      source: row.source,
    },
  };
}

async function loadAftnMessages(
  airportId: string,
  from: Date,
  to: Date,
): Promise<TimelineEvent[]> {
  const rows = await db
    .select()
    .from(aftnMessages)
    .where(aftnWindowFilter(airportId, from, to));

  return rows.map(aftnRowToEvent);
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
