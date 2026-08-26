import { aerodromeFeatures, db } from "@repo/database";
import { logger } from "@repo/logger";
import { ApiError } from "@repo/shared";
import { and, eq } from "drizzle-orm";
import {
  publishAerodromeGeometryUpdated,
  publishNotamEvent,
} from "../../messaging/advisory.producer";
import type { FetchNotamParams } from "../../provider/notam.provider";
import { fetchNotamMessages } from "../../provider/notam.provider";
import type { NotamSourceItem } from "../parser/common";
import { parseNotamMessage } from "../parser/notam.parser";
import {
  type NotamUpsertOutcome,
  upsertNotamMessage,
} from "../repository/notam.repository";
import { NOTAM_PROVIDER_SOURCE } from "./notam.service";

export interface TriggerNotamInput {
  body: NotamSourceItem;
  airportId: string;
}

export interface TriggerNotamResult {
  notamOutcome: NotamUpsertOutcome;
  airportId: string;
  notam: NotamSourceItem;
  matchedFeature?: {
    id: string;
    name: string | null;
    status: string | null;
  };
}

type LatLon = [number, number];

const COORDINATE_PATTERN =
  /^(\d{2})(\d{2})(\d{2})?([NS])(\d{3})(\d{2})(\d{2})?([EW])(\d{3})?$/;

function toDecimal(
  degrees: number,
  minutes: number,
  seconds: number,
  hemisphere: "N" | "S" | "E" | "W",
): number {
  const value = degrees + minutes / 60 + seconds / 3600;
  return hemisphere === "S" || hemisphere === "W" ? -value : value;
}

function parseNotamCoordinate(value: string | null): LatLon | null {
  if (!value) {
    return null;
  }

  const match = COORDINATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const [, latDeg, latMin, latSec, latH, lonDeg, lonMin, lonSec, lonH] = match;

  const lat = toDecimal(
    Number(latDeg),
    Number(latMin),
    latSec ? Number(latSec) : 0,
    latH as "N" | "S",
  );
  const lon = toDecimal(
    Number(lonDeg),
    Number(lonMin),
    lonSec ? Number(lonSec) : 0,
    lonH as "E" | "W",
  );

  return [lat, lon];
}

function pointInPolygon(point: LatLon, polygon: LatLon[]): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-12) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function isPointInFeature(point: LatLon, geometry: unknown): boolean {
  const geo = geometry as {
    type?: unknown;
    coordinates?: unknown;
  };

  if (!geo || geo.type !== "Polygon" || !Array.isArray(geo.coordinates)) {
    return false;
  }

  const rings = geo.coordinates as unknown[][];
  const firstRing = rings[0];

  if (!Array.isArray(firstRing) || firstRing.length === 0) {
    return false;
  }

  const ring = firstRing.filter(
    (p): p is [number, number] =>
      Array.isArray(p) && p.length >= 2 && typeof p[0] === "number",
  );

  const polygon = ring.map<LatLon>(([lon, lat]) => [lat, lon]);

  return pointInPolygon(point, polygon);
}

export async function triggerNotam({
  body,
  airportId,
}: TriggerNotamInput): Promise<TriggerNotamResult> {
  const parsed = parseNotamMessage(body);

  if (!parsed.ok) {
    throw new ApiError("BAD_REQUEST", {
      message: `Invalid NOTAM: ${parsed.reason}`,
    });
  }

  const message = parsed.message;
  const outcome = await upsertNotamMessage(message, {
    source: NOTAM_PROVIDER_SOURCE,
  });

  await publishNotamEvent("NOTAM_UPDATED", airportId);

  const notamPoint = parseNotamCoordinate(message.coordinates);

  if (!notamPoint) {
    logger.warn(
      { airportId, coordinates: message.coordinates },
      "NOTAM coordinates could not be parsed",
    );
    return { notamOutcome: outcome, airportId, notam: body };
  }

  const taxiways = await db.query.aerodromeFeatures.findMany({
    where: and(
      eq(aerodromeFeatures.airportId, airportId),
      eq(aerodromeFeatures.layer, "TAXIWAY"),
    ),
  });

  const matched = taxiways.find((feature) =>
    isPointInFeature(notamPoint, feature.geometry),
  );

  if (!matched) {
    logger.warn(
      { airportId, coordinates: message.coordinates },
      "NOTAM point did not match any taxiway",
    );
    return { notamOutcome: outcome, airportId, notam: body };
  }

  const previousProperties = (matched.properties ?? {}) as Record<
    string,
    unknown
  >;

  await db
    .update(aerodromeFeatures)
    .set({
      status: "INACTIVE",
      properties: {
        ...previousProperties,
        notamId: message.providerId,
        notamQcode: message.qcode,
        notamEffectiveFrom: message.effectiveFrom.toISOString(),
        notamEffectiveTo: message.effectiveTo.toISOString(),
        notamTriggeredAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(aerodromeFeatures.id, matched.id));

  await publishAerodromeGeometryUpdated(airportId);

  return {
    notamOutcome: outcome,
    airportId,
    notam: body,
    matchedFeature: {
      id: matched.id,
      name: matched.name,
      status: "INACTIVE",
    },
  };
}

export interface TriggerNotamsInput {
  items: NotamSourceItem[];
  airportId: string;
}

export interface TriggerNotamsResult {
  airportId: string;
  processed: number;
  matched: number;
  results: TriggerNotamResult[];
}

export async function triggerNotams({
  items,
  airportId,
}: TriggerNotamsInput): Promise<TriggerNotamsResult> {
  const results: TriggerNotamResult[] = [];

  for (const item of items) {
    try {
      const result = await triggerNotam({ body: item, airportId });
      results.push(result);
    } catch (err) {
      logger.warn({ err, airportId, item }, "failed to trigger notam item");
      results.push({
        notamOutcome: "unchanged",
        airportId,
        notam: item,
      });
    }
  }

  const matched = results.filter((r) => r.matchedFeature).length;

  return {
    airportId,
    processed: items.length,
    matched,
    results,
  };
}

export interface FetchAndTriggerNotamsInput extends FetchNotamParams {
  airportId: string;
}

export async function fetchAndTriggerNotams({
  airportId,
  startDate,
  endDate,
}: FetchAndTriggerNotamsInput): Promise<TriggerNotamsResult> {
  const items = await fetchNotamMessages({ startDate, endDate });
  return triggerNotams({ items, airportId });
}
