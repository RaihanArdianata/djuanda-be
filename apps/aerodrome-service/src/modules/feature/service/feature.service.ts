import {
  type AerodromeFeature,
  aerodromeFeatures,
  aerodromeFeaturesSelectSchema,
  db,
} from "@repo/database";
import { ApiError } from "@repo/shared";
import { eq, type SQL, sql } from "drizzle-orm";
import z from "zod";
import { publishAerodromeGeometryUpdated } from "../../messaging/aerodrome.producer";
import type {
  CreateFeatureInput,
  ListFeatureQueryInput,
  UpdateFeatureInput,
} from "../validator/feature.validator";

function getAirportIdFromFeature(feature: {
  properties?: unknown;
}): string | undefined {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const airportId = props.airportId ?? props.icao;
  return typeof airportId === "string" && airportId.length > 0
    ? airportId
    : undefined;
}

async function resolveAirportId(feature: {
  properties?: unknown;
}): Promise<string | undefined> {
  const fromProps = getAirportIdFromFeature(feature);
  if (fromProps) return fromProps;

  const fallback = await db.query.aerodromeFeatures.findFirst({
    where: eq(aerodromeFeatures.layer, "AERODROME"),
  });
  return fallback ? getAirportIdFromFeature(fallback) : undefined;
}

export const listFeatureResultSchema = z.object({
  items: z.array(aerodromeFeaturesSelectSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

export type ListFeatureResult = z.infer<typeof listFeatureResultSchema>;

export async function listFeatures(
  params: ListFeatureQueryInput,
): Promise<ListFeatureResult> {
  const { layer, page, limit } = params;
  const offset = (page - 1) * limit;
  const where: SQL | undefined = layer
    ? eq(aerodromeFeatures.layer, layer)
    : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(aerodromeFeatures)
      .where(where)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aerodromeFeatures)
      .where(where),
  ]);

  return {
    items: aerodromeFeaturesSelectSchema.array().parse(items),
    total: totalRow[0].count,
    page,
    limit,
  };
}

export async function getFeatureById(
  id: string,
): Promise<AerodromeFeature | null> {
  const feature = await db.query.aerodromeFeatures.findFirst({
    where: eq(aerodromeFeatures.id, id),
  });

  if (!feature)
    throw new ApiError("NOT_FOUND", { message: "Feature not found" });

  return aerodromeFeaturesSelectSchema.parse(feature);
}

export async function createFeature(
  data: CreateFeatureInput & { userId?: string },
): Promise<AerodromeFeature> {
  const airportId = await resolveAirportId(data);
  const [feature] = await db
    .insert(aerodromeFeatures)
    .values({
      layer: data.layer,
      name: data.name,
      status: data.status,
      geometry: data.geometry,
      properties: airportId
        ? { ...data.properties, airportId }
        : data.properties,
      createdBy: data.userId,
      updatedBy: data.userId,
    })
    .returning();

  const created = aerodromeFeaturesSelectSchema.parse(feature);
  const createdAirportId = getAirportIdFromFeature(created);
  if (createdAirportId) {
    await publishAerodromeGeometryUpdated(createdAirportId);
  }
  return created;
}

export async function updateFeature(
  id: string,
  patch: UpdateFeatureInput,
  userId?: string,
): Promise<AerodromeFeature> {
  const existing = await db.query.aerodromeFeatures.findFirst({
    where: eq(aerodromeFeatures.id, id),
  });
  if (!existing)
    throw new ApiError("NOT_FOUND", { message: "Feature not found" });

  const airportId = await resolveAirportId(existing);
  const baseProperties =
    patch.properties ?? (existing.properties as Record<string, unknown>);
  const properties = airportId
    ? { ...baseProperties, airportId }
    : baseProperties;

  const [updated] = await db
    .update(aerodromeFeatures)
    .set({ ...patch, properties, updatedBy: userId, updatedAt: new Date() })
    .where(eq(aerodromeFeatures.id, id))
    .returning();
  if (!updated)
    throw new ApiError("NOT_FOUND", { message: "Feature not found" });
  const updatedFeature = aerodromeFeaturesSelectSchema.parse(updated);
  const updatedAirportId = getAirportIdFromFeature(updatedFeature);
  if (updatedAirportId) {
    await publishAerodromeGeometryUpdated(updatedAirportId);
  }
  return updatedFeature;
}

export async function deleteFeature(id: string): Promise<void> {
  const [deleted] = await db
    .delete(aerodromeFeatures)
    .where(eq(aerodromeFeatures.id, id))
    .returning();
  if (!deleted)
    throw new ApiError("NOT_FOUND", { message: "Feature not found" });
  const deletedFeature = aerodromeFeaturesSelectSchema.parse(deleted);
  const airportId =
    getAirportIdFromFeature(deletedFeature) ??
    (await resolveAirportId(deletedFeature));
  if (airportId) {
    await publishAerodromeGeometryUpdated(airportId);
  }
}
