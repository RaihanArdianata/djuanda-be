import { aerodromeFeatures, db } from "@repo/database";
import { logger } from "@repo/logger";
import { ApiError } from "@repo/shared";
import { eq, inArray } from "drizzle-orm";
import {
  publishAerodromeGeometryUpdated,
  publishNotamEvent,
} from "../../messaging/advisory.producer";
import type { FetchNotamParams } from "../../provider/notam.provider";
import { fetchNotamMessages } from "../../provider/notam.provider";
import { extractPolygon } from "../lib/aerodrome-polygon";
import type { NormalizedNotamMessage, NotamSourceItem } from "../parser/common";
import { parseNotamMessage } from "../parser/notam.parser";
import {
  type NotamUpsertOutcome,
  upsertNotamMessage,
} from "../repository/notam.repository";

const NOTAM_PROVIDER_SOURCE = "advisory-provider-notam";

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

const DEFAULT_NOTAM_RADIUS_M = 100;
const METERS_PER_DEGREE_LAT = 111320;

interface ParsedNotamCoordinate {
  lat: number;
  lon: number;
  radius: number | null;
}

function toDecimal(
  degrees: number,
  minutes: number,
  seconds: number,
  hemisphere: "N" | "S" | "E" | "W",
): number {
  const value = degrees + minutes / 60 + seconds / 3600;
  return hemisphere === "S" || hemisphere === "W" ? -value : value;
}

function metersPerDegreeLon(latitude: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180);
}

function buildCirclePolygon(
  lat: number,
  lon: number,
  radiusMeters: number,
  segments = 32,
): { type: "Polygon"; coordinates: [number, number][][] } {
  const ring: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (2 * Math.PI * i) / segments;
    const dx = radiusMeters * Math.cos(theta);
    const dy = radiusMeters * Math.sin(theta);
    const dLat = dy / METERS_PER_DEGREE_LAT;
    const dLon = dx / metersPerDegreeLon(lat);
    ring.push([lon + dLon, lat + dLat]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

function parseNotamCoordinate(
  value: string | null,
): ParsedNotamCoordinate | null {
  if (!value) {
    return null;
  }

  const match = COORDINATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const [, latDeg, latMin, latSec, latH, lonDeg, lonMin, lonSec, lonH, radius] =
    match;

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

  return {
    lat,
    lon,
    radius: radius ? Number(radius) : null,
  };
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

function isPointInFeature(
  point: LatLon,
  feature: {
    layer: string;
    geometry: unknown;
    properties: unknown;
  },
): boolean {
  const polygon = extractPolygon(
    feature.geometry,
    feature.layer,
    (feature.properties ?? {}) as Record<string, unknown>,
  );
  if (polygon.length === 0) return false;
  return pointInPolygon(point, polygon);
}

function extractFeatureRef(item: NotamSourceItem): string | null {
  const raw = typeof item.raw === "string" ? item.raw : undefined;
  const remark = typeof item.remark === "string" ? item.remark : undefined;
  const source = [raw, remark].filter(Boolean).join(" ");
  const matches: string[] = [];
  const pattern =
    /(?:TAXIWAY|TWY|RWY|RUNWAY|APRON)\s+([A-Z0-9]+(?:\/[A-Z0-9]+)?)/gi;
  let match: RegExpExecArray | null = null;
  do {
    match = pattern.exec(source);
    if (match) matches.push(match[1].toUpperCase());
  } while (match !== null);
  return matches[0] ?? null;
}

function isNotamClosure(item: NotamSourceItem): boolean {
  const raw = typeof item.raw === "string" ? item.raw : "";
  const remark = typeof item.remark === "string" ? item.remark : "";
  const source = `${raw} ${remark}`.toUpperCase();
  return /\b(?:CLSD|CLOSED|RESTRICTED)\b/i.test(source);
}

async function reactivateNotamFeatures(
  notam: NormalizedNotamMessage,
  airportId: string,
): Promise<string[]> {
  const features = await db.query.aerodromeFeatures.findMany({
    where: eq(aerodromeFeatures.airportId, airportId),
  });

  const reactivatedIds: string[] = [];
  for (const f of features) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (
      props.notamSeries === notam.series &&
      props.notamNumber === notam.number &&
      props.notamYear === notam.year &&
      f.status !== "ACTIVE"
    ) {
      const previousProperties = (f.properties ?? {}) as Record<
        string,
        unknown
      >;

      await db
        .update(aerodromeFeatures)
        .set({
          status: "ACTIVE",
          properties: {
            ...previousProperties,
            status: "ACTIVE",
            active: true,
          },
          updatedAt: new Date(),
        })
        .where(eq(aerodromeFeatures.id, f.id));

      reactivatedIds.push(f.id);
    }
  }

  return reactivatedIds;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: NOTAM trigger coordinates multiple feature layers and status cases by design.
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

  let geometryUpdated = false;

  if (message.type === "NOTAMC" || message.type === "NOTAMR") {
    const reactivated = await reactivateNotamFeatures(message, airportId);
    if (reactivated.length > 0) {
      geometryUpdated = true;
    }
    logger.info(
      { notamType: message.type, reactivated: reactivated.length },
      "NOTAM reactivated features",
    );
    if (message.type === "NOTAMC") {
      if (geometryUpdated) {
        await publishAerodromeGeometryUpdated(airportId);
      }
      return {
        notamOutcome: outcome,
        airportId,
        notam: body,
      };
    }
  }

  const notamCoord = parseNotamCoordinate(message.coordinates);

  if (!notamCoord) {
    if (geometryUpdated) {
      await publishAerodromeGeometryUpdated(airportId);
    } else {
      logger.warn(
        { airportId, coordinates: message.coordinates },
        "NOTAM coordinates could not be parsed",
      );
    }
    return { notamOutcome: outcome, airportId, notam: body };
  }

  const notamPoint: LatLon = [notamCoord.lat, notamCoord.lon];
  const notamRadius = notamCoord.radius ?? DEFAULT_NOTAM_RADIUS_M;

  const notamLayers = ["RUNWAY", "TAXIWAY", "APRON", "RESTRICTED"] as const;

  const candidates = await db.query.aerodromeFeatures.findMany({
    where: inArray(aerodromeFeatures.layer, [...notamLayers]),
  });

  const features = candidates.filter((f) => {
    if (f.airportId === airportId) return true;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const icao = props.icao;
    const featureAirportId = props.airportId;
    if (icao === airportId || featureAirportId === airportId) return true;
    return f.airportId == null && icao == null && featureAirportId == null;
  });

  const notamRef = extractFeatureRef(body);

  let matched = notamRef
    ? features.find((f) => {
        const props = (f.properties ?? {}) as Record<string, unknown>;
        const ref = props.ref as string | undefined;
        const name = props.name as string | undefined;
        return (
          f.name?.toUpperCase() === notamRef ||
          ref?.toUpperCase() === notamRef ||
          name?.toUpperCase() === notamRef
        );
      })
    : undefined;

  if (!matched) {
    matched = features.find((feature) => isPointInFeature(notamPoint, feature));
  }

  logger.info(
    {
      airportId,
      notamPoint,
      notamRef: notamRef ?? null,
      candidates: candidates.length,
      matchedLayerCount: features.length,
      matchedId: matched?.id,
      matchedLayer: matched?.layer,
      matchedName: matched?.name,
    },
    "NOTAM aerodrome feature lookup",
  );

  const notamProperties = {
    notamId: message.providerId,
    notamSeries: message.series,
    notamNumber: message.number,
    notamYear: message.year,
    notamQcode: message.qcode,
    notamEffectiveFrom: message.effectiveFrom.toISOString(),
    notamEffectiveTo: message.effectiveTo.toISOString(),
    notamTriggeredAt: new Date().toISOString(),
  };

  function buildAerodromeProperties(
    previous: Record<string, unknown>,
    newStatus: string,
  ): Record<string, unknown> {
    return {
      ...previous,
      ...notamProperties,
      status: newStatus,
      active: newStatus === "ACTIVE",
    };
  }

  let matchedFeature: TriggerNotamResult["matchedFeature"];

  if (matched) {
    const newStatus =
      matched.layer === "RESTRICTED"
        ? "RESTRICTED"
        : isNotamClosure(body)
          ? "INACTIVE"
          : undefined;

    if (newStatus) {
      const previousProperties = (matched.properties ?? {}) as Record<
        string,
        unknown
      >;

      await db
        .update(aerodromeFeatures)
        .set({
          status: newStatus,
          properties: buildAerodromeProperties(previousProperties, newStatus),
          updatedAt: new Date(),
        })
        .where(eq(aerodromeFeatures.id, matched.id));

      matchedFeature = {
        id: matched.id,
        name: matched.name,
        status: newStatus,
      };
    } else {
      logger.info(
        { matchedId: matched.id, matchedName: matched.name },
        "NOTAM matched but not a closure; no status change",
      );
    }
  } else {
    logger.warn(
      { airportId, coordinates: message.coordinates },
      "NOTAM point did not match any existing aerodrome feature; creating temporary restricted area",
    );

    const inserted = await db
      .insert(aerodromeFeatures)
      .values({
        airportId,
        layer: "RESTRICTED",
        name: message.providerId,
        status: "RESTRICTED",
        geometry: buildCirclePolygon(
          notamCoord.lat,
          notamCoord.lon,
          notamRadius,
        ),
        properties: buildAerodromeProperties(
          { restricted: true, source: "NOTAM" },
          "RESTRICTED",
        ),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: aerodromeFeatures.id,
        name: aerodromeFeatures.name,
        status: aerodromeFeatures.status,
      });

    matchedFeature = inserted[0] ?? undefined;
  }

  if (matchedFeature !== undefined || geometryUpdated) {
    await publishAerodromeGeometryUpdated(airportId);
  }

  return {
    notamOutcome: outcome,
    airportId,
    notam: body,
    matchedFeature,
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
