import {
  type AerodromeFeature,
  aerodromeFeatures,
  aerodromeFeaturesSelectSchema,
  db,
} from "@repo/database";
import { ApiError } from "@repo/shared";
import { eq, type SQL, sql } from "drizzle-orm";
import z from "zod";
import type {
  CreateFeatureInput,
  ListFeatureQueryInput,
  UpdateFeatureInput,
} from "../validator/feature.validator";

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
  const [feature] = await db
    .insert(aerodromeFeatures)
    .values({
      layer: data.layer,
      name: data.name,
      geometry: data.geometry,
      properties: data.properties,
      createdBy: data.userId,
      updatedBy: data.userId,
    })
    .returning();

  return aerodromeFeaturesSelectSchema.parse(feature);
}

export async function updateFeature(
  id: string,
  patch: UpdateFeatureInput,
  userId?: string,
): Promise<AerodromeFeature> {
  const [updated] = await db
    .update(aerodromeFeatures)
    .set({ ...patch, updatedBy: userId, updatedAt: new Date() })
    .where(eq(aerodromeFeatures.id, id))
    .returning();
  if (!updated)
    throw new ApiError("NOT_FOUND", { message: "Feature not found" });
  return aerodromeFeaturesSelectSchema.parse(updated);
}

export async function deleteFeature(id: string): Promise<void> {
  const [deleted] = await db
    .delete(aerodromeFeatures)
    .where(eq(aerodromeFeatures.id, id))
    .returning();
  if (!deleted)
    throw new ApiError("NOT_FOUND", { message: "Feature not found" });
}
