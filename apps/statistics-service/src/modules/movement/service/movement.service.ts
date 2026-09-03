import { type AeroswarmMovement, aeroswarmMovements, db } from "@repo/database";
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { buildMovementId } from "../lib/movement-id";
import type {
  GetMovementsParams,
  MovementApiType,
} from "../validator/movement.validator";

export interface AircraftMovement {
  id: string;
  trackId: string;
  callsign?: string;
  icao24?: string;
  airportId: string;
  type: MovementApiType;
  eventTime: string;
}
const API_TO_DB_TYPE: Record<MovementApiType, "takeoff" | "landing"> = {
  TAKE_OFF: "takeoff",
  LANDING: "landing",
};
const DB_TO_API_TYPE: Record<"takeoff" | "landing", MovementApiType> = {
  takeoff: "TAKE_OFF",
  landing: "LANDING",
};

function isKnownMovementType(value: string): value is "takeoff" | "landing" {
  return value === "takeoff" || value === "landing";
}
function toAircraftMovement(row: AeroswarmMovement): AircraftMovement | null {
  if (!isKnownMovementType(row.type)) return null;
  if (!row.airportId) return null;

  return {
    id: buildMovementId(row.trackId, row.type, row.at),
    trackId: row.trackId,
    ...(row.callsign ? { callsign: row.callsign } : {}),
    ...(row.icao24 ? { icao24: row.icao24 } : {}),
    airportId: row.airportId,
    type: DB_TO_API_TYPE[row.type],
    eventTime: row.at.toISOString(),
  };
}

export async function getMovements(
  params: GetMovementsParams,
): Promise<AircraftMovement[]> {
  const conditions: SQL[] = [];

  if (params.type) {
    conditions.push(eq(aeroswarmMovements.type, API_TO_DB_TYPE[params.type]));
  }
  if (params.airportId) {
    conditions.push(eq(aeroswarmMovements.airportId, params.airportId));
  }
  if (params.startDateTime) {
    conditions.push(gte(aeroswarmMovements.at, params.startDateTime));
  }
  if (params.endDateTime) {
    conditions.push(lte(aeroswarmMovements.at, params.endDateTime));
  }
  const rows = await db
    .select()
    .from(aeroswarmMovements)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aeroswarmMovements.at));

  const movements: AircraftMovement[] = [];
  for (const row of rows) {
    const dto = toAircraftMovement(row);
    if (dto) movements.push(dto);
  }
  return movements;
}
