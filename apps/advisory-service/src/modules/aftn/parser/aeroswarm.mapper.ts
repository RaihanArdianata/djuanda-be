import { logger } from "@repo/logger";
import type { NormalizedAftnMessage } from "./common";

/**
 * Event yang dipublish feed AFTN AeroSwarm ke topic aero.flightplan.v1 lalu
 * diteruskan connector Kafka ke aeroswarm.flightplan.warr — bentuknya
 * FlightPlanEvent dari @aeroswarm/core (didefinisikan ulang di sini supaya
 * tidak perlu depend ke package AeroSwarm).
 */
interface AeroswarmAftnMessage {
  type?: unknown;
  header?: unknown;
  text?: unknown;
  callsign?: unknown;
  flightRules?: unknown;
  flightType?: unknown;
  aircraftType?: unknown;
  wake?: unknown;
  equipment?: unknown;
  adep?: unknown;
  ades?: unknown;
  eobt?: unknown;
  atd?: unknown;
  ata?: unknown;
  eet?: unknown;
  cruiseSpeed?: unknown;
  cruiseLevel?: unknown;
  route?: unknown;
  alternates?: unknown;
  other?: unknown;
  registration?: unknown;
  icao24?: unknown;
  dof?: unknown;
  changes?: unknown;
  eobtAt?: unknown;
  atdAt?: unknown;
  ataAt?: unknown;
}

interface AeroswarmFlightPlanEvent {
  messageId?: unknown;
  sourceId?: unknown;
  feedId?: unknown;
  airportId?: unknown;
  receivedAt?: unknown;
  message?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const upper = (value: unknown): string | null => {
  const s = str(value);
  return s === null ? null : s.toUpperCase();
};

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const compact = (obj: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null),
  );

const isAeroswarmFlightPlanEvent = (
  value: unknown,
): value is AeroswarmFlightPlanEvent =>
  isRecord(value) && isRecord(value.message);

/**
 * FlightPlanEvent -> NormalizedAftnMessage supaya masuk pipeline
 * upsertAftnMessage yang sama dengan sync NAVSIM. Kolom yang tidak ada di
 * event AeroSwarm dibiarkan null; field ekstra codec (icao24, DOF, header,
 * epoch times) masuk ke `parsed`.
 */
export const mapAeroswarmFlightPlanEvent = (
  value: unknown,
): NormalizedAftnMessage | null => {
  if (!isAeroswarmFlightPlanEvent(value)) {
    logger.warn({ value }, "not an aeroswarm flightplan event — skipped");
    return null;
  }

  const message = value.message as AeroswarmAftnMessage;
  const messageType = upper(message.type);
  if (!messageType) {
    logger.warn(
      { event: value },
      "aeroswarm flightplan event missing message.type — skipped",
    );
    return null;
  }

  return {
    datetime: new Date(num(value.receivedAt) ?? Date.now()),
    messageType,
    callSign: upper(message.callsign),
    registration: upper(message.registration),
    aircraftType: upper(message.aircraftType),
    departure: upper(message.adep),
    // DEP/DLA membawa waktu aktual/revisi — eobt FPL, atd DEP, eobt baru DLA.
    departureTime: str(message.eobt) ?? str(message.atd),
    destination: upper(message.ades),
    destinationTime: str(message.ata),
    duration: str(message.eet),
    speed: upper(message.cruiseSpeed),
    altitude: upper(message.cruiseLevel),
    route: str(message.route),
    raw: str(message.text) ?? "",
    parsed: compact({
      messageId: str(value.messageId),
      sourceId: str(value.sourceId),
      feedId: str(value.feedId),
      airportId: str(value.airportId),
      header: message.header,
      flightRules: str(message.flightRules),
      flightType: str(message.flightType),
      wake: str(message.wake),
      equipment: str(message.equipment),
      alternates: message.alternates,
      other: message.other,
      changes: message.changes,
      icao24: str(message.icao24),
      dof: str(message.dof),
      eobtAt: num(message.eobtAt),
      atdAt: num(message.atdAt),
      ataAt: num(message.ataAt),
    }),
  };
};
