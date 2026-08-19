import {
  type AerodromeImport,
  type AerodromeImportFeature,
  type AerodromeImportWithFeatures,
  aerodromeFeatures,
  aerodromeImportFeatures,
  aerodromeImportFeaturesSelectSchema,
  aerodromeImports,
  db,
  type LayerName,
} from "@repo/database";
import { ApiError } from "@repo/shared";
import { and, eq } from "drizzle-orm";
import { validateGeometry } from "@/lib/geometry-validation";
import { resolveLayer } from "@/lib/layers";
import type { GeoJson, GeoJsonFeature, GeoJsonGeometry } from "@/types/geojson";
import { publishAerodromeGeometryUpdated } from "../../messaging/aerodrome.producer";
import type {
  AddPreviewFeatureInput,
  UpdatePreviewFeatureInput,
} from "../validator/import.validator";

interface DraftRow {
  importId: string;
  layer: LayerName;
  geometry: unknown;
  properties: Record<string, unknown>;
  validationStatus: "VALID" | "INVALID";
  validationErrors: string[];
  isEdited: boolean;
}

export async function createImportSession(
  fileName: string,
  geojson: Record<string, unknown>,
  mode: "APPEND" | "REPLACE",
  userId?: string,
): Promise<AerodromeImport> {
  const rawFeatures = extractFeatures(geojson);
  const rows = rawFeatures.map((f) =>
    buildDraftRow("", f.layerHint, f.geometry, f.properties ?? {}),
  );
  markDuplicates(rows);

  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(aerodromeImports)
      .values({
        filename: fileName,
        mode,
        status: "DRAFT",
        totalFeatures: rows.length,
        createdBy: userId,
      })
      .returning();

    if (rows.length > 0) {
      await tx
        .insert(aerodromeImportFeatures)
        .values(rows.map((r) => ({ ...r, importId: session.id })));
    }

    const validCount = rows.filter(
      (r) => r.validationStatus === "VALID",
    ).length;

    const [updated] = await tx
      .update(aerodromeImports)
      .set({
        validFeatures: validCount,
        invalidFeatures: rows.length - validCount,
      })
      .where(eq(aerodromeImports.id, session.id))
      .returning();

    return updated;
  });
}

export async function getImportPreview(
  importId: string,
): Promise<AerodromeImportWithFeatures> {
  const session = await db.query.aerodromeImports.findFirst({
    where: eq(aerodromeImports.id, importId),
    with: { features: true },
  });
  if (!session)
    throw new ApiError("NOT_FOUND", {
      message: "Import session tidak ditemukan",
    });

  const features = session.features.map((f) =>
    aerodromeImportFeaturesSelectSchema.parse(f),
  );

  return {
    ...session,
    features,
  };
}

export async function updatePreviewFeature(
  importId: string,
  featureId: string,
  patch: UpdatePreviewFeatureInput,
): Promise<AerodromeImportFeature> {
  const existing = await db.query.aerodromeImportFeatures.findFirst({
    where: and(
      eq(aerodromeImportFeatures.id, featureId),
      eq(aerodromeImportFeatures.importId, importId),
    ),
  });
  if (!existing)
    throw new ApiError("NOT_FOUND", { message: "Feature tidak ditemukan" });

  const geometry = patch.geometry ?? existing.geometry;
  const properties =
    patch.properties ?? (existing.properties as Record<string, unknown>);
  const layer =
    patch.layer ?? resolveLayer(properties) ?? (existing.layer as LayerName);

  const geometryCheck = validateGeometry(
    geometry as unknown as GeoJsonGeometry,
  );
  const errors = [...geometryCheck.errors];
  if (!patch.layer && !resolveLayer(properties))
    errors.push("Layer tidak dikenali dari properties");

  const [updated] = await db
    .update(aerodromeImportFeatures)
    .set({
      layer,
      geometry,
      properties,
      validationStatus: errors.length === 0 ? "VALID" : "INVALID",
      validationErrors: errors,
      isEdited: true,
      updatedAt: new Date(),
    })
    .where(eq(aerodromeImportFeatures.id, featureId))
    .returning();

  await recalculateImportCounts(importId);

  return aerodromeImportFeaturesSelectSchema.parse(updated);
}

export async function deletePreviewFeature(
  importId: string,
  featureId: string,
): Promise<void> {
  const result = await db
    .delete(aerodromeImportFeatures)
    .where(
      and(
        eq(aerodromeImportFeatures.id, featureId),
        eq(aerodromeImportFeatures.importId, importId),
      ),
    )
    .returning();
  if (result.length === 0)
    throw new ApiError("NOT_FOUND", { message: "Feature tidak ditemukan" });
  await recalculateImportCounts(importId);
}

export async function addPreviewFeature(
  importId: string,
  input: AddPreviewFeatureInput,
): Promise<AerodromeImportFeature> {
  const session = await db.query.aerodromeImports.findFirst({
    where: eq(aerodromeImports.id, importId),
  });
  if (!session)
    throw new ApiError("NOT_FOUND", {
      message: "Import session tidak ditemukan",
    });

  const row = buildDraftRow(
    importId,
    input.layer,
    input.geometry,
    input.properties,
  );
  row.isEdited = true;

  const [created] = await db
    .insert(aerodromeImportFeatures)
    .values(row)
    .returning();
  await recalculateImportCounts(importId);
  return aerodromeImportFeaturesSelectSchema.parse(created);
}

function deriveAirportId(
  features: { properties: unknown }[],
): string | undefined {
  for (const f of features) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const value =
      (props.airportId as string) ??
      (props.icao as string) ??
      (props.iata as string);
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export async function commitImport(
  importId: string,
  userId?: string,
): Promise<AerodromeImport> {
  const result = await db.transaction(async (tx) => {
    const session = await tx.query.aerodromeImports.findFirst({
      where: eq(aerodromeImports.id, importId),
      with: { features: true },
    });
    if (!session)
      throw new ApiError("NOT_FOUND", {
        message: "Import session tidak ditemukan",
      });
    if (session.status !== "DRAFT") {
      throw new ApiError("BAD_REQUEST", {
        message: "Import session sudah tidak berstatus DRAFT",
      });
    }

    const invalid = session.features.filter(
      (f) => f.validationStatus !== "VALID",
    );
    if (invalid.length > 0) {
      throw new ApiError("BAD_REQUEST", {
        message: "Terdapat feature invalid, commit dibatalkan",
        fields: { invalidFeatureIds: invalid.map((f) => f.id) },
      });
    }

    if (session.mode === "REPLACE") {
      await tx.delete(aerodromeFeatures);
    }

    const airportId = deriveAirportId(session.features);

    if (session.features.length > 0) {
      await tx.insert(aerodromeFeatures).values(
        session.features.map((f) => ({
          layer: f.layer,
          airportId,
          geometry: f.geometry,
          properties: airportId
            ? {
                ...((f.properties ?? {}) as Record<string, unknown>),
                airportId,
              }
            : f.properties,
          createdBy: userId,
          updatedBy: userId,
        })),
      );
    }

    const [updated] = await tx
      .update(aerodromeImports)
      .set({ status: "COMPLETED", updatedAt: new Date() })
      .where(eq(aerodromeImports.id, importId))
      .returning();

    return { ...updated, airportId };
  });

  if (result.airportId) {
    await publishAerodromeGeometryUpdated(result.airportId);
  }

  return result;
}

export async function cancelImport(importId: string): Promise<AerodromeImport> {
  const [updated] = await db
    .update(aerodromeImports)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(eq(aerodromeImports.id, importId))
    .returning();
  if (!updated)
    throw new ApiError("NOT_FOUND", {
      message: "Import session tidak ditemukan",
    });
  return updated;
}

function extractFeatures(geojson: Record<string, unknown>): Array<{
  geometry: GeoJsonGeometry;
  properties: Record<string, unknown>;
  layerHint?: LayerName;
}> {
  let features: GeoJsonFeature[];

  if (
    geojson?.type === "FeatureCollection" &&
    Array.isArray(geojson.features)
  ) {
    features = (geojson as unknown as GeoJson<GeoJsonGeometry>).features;
  } else if (geojson?.type === "Feature") {
    features = [geojson as unknown as GeoJsonFeature<GeoJsonGeometry>];
  } else {
    throw new ApiError("BAD_REQUEST", {
      message: "GeoJSON harus berupa Feature atau FeatureCollection",
    });
  }

  return features.map((f) => ({
    geometry: f.geometry,
    properties: f.properties ?? {},
  }));
}

function buildDraftRow(
  importId: string,
  layerOverride: LayerName | undefined,
  geometry: unknown,
  properties: Record<string, unknown>,
): DraftRow {
  const geometryCheck = validateGeometry(
    geometry as unknown as GeoJsonGeometry,
  );
  const layer = layerOverride ?? resolveLayer(properties);
  const errors = [...geometryCheck.errors];
  if (!layer) errors.push("Layer tidak dikenali dari properties");

  return {
    importId,
    layer: layer ?? "AERODROME", // placeholder, tetap invalid lewat validationErrors
    geometry,
    properties,
    validationStatus: errors.length === 0 ? "VALID" : "INVALID",
    validationErrors: errors,
    isEdited: false,
  };
}

function markDuplicates(rows: DraftRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.layer}:${JSON.stringify(row.geometry)}`;
    if (seen.has(key)) {
      row.validationErrors.push("Duplicate feature terdeteksi");
      row.validationStatus = "INVALID";
    } else {
      seen.add(key);
    }
  }
}

async function recalculateImportCounts(importId: string): Promise<void> {
  const features = await db.query.aerodromeImportFeatures.findMany({
    where: eq(aerodromeImportFeatures.importId, importId),
  });
  const validCount = features.filter(
    (f) => f.validationStatus === "VALID",
  ).length;
  await db
    .update(aerodromeImports)
    .set({
      totalFeatures: features.length,
      validFeatures: validCount,
      invalidFeatures: features.length - validCount,
      updatedAt: new Date(),
    })
    .where(eq(aerodromeImports.id, importId));
}
