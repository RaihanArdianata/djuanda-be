import kinks from "@turf/kinks";
import type { Feature, Geometry, Polygon, MultiPolygon } from "geojson";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_GEOMETRY_TYPES = new Set([
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
]);

export function validateGeometry(
  geometry: Geometry | null | undefined,
): ValidationResult {
  const errors: string[] = [];

  if (!geometry || typeof geometry !== "object" || !("type" in geometry)) {
    return { valid: false, errors: ["Geometry tidak valid atau kosong"] };
  }

  if (!VALID_GEOMETRY_TYPES.has(geometry.type)) {
    errors.push(`Tipe geometry '${geometry.type}' tidak dikenali`);
    return { valid: false, errors };
  }

  if (!hasValidCoordinates(geometry)) {
    errors.push(
      "Koordinat tidak valid (di luar rentang lng/lat atau format salah)",
    );
  }

  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    if (hasSelfIntersection(geometry)) {
      errors.push("Polygon memiliki self-intersection");
    }
  }

  return { valid: errors.length === 0, errors };
}

function hasValidCoordinates(geometry: Geometry): boolean {
  const check = (coord: unknown): boolean => {
    if (
      Array.isArray(coord) &&
      coord.length >= 2 &&
      typeof coord[0] === "number" &&
      typeof coord[1] === "number"
    ) {
      const [lng, lat] = coord;
      return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
    }
    if (Array.isArray(coord)) {
      return coord.length > 0 && coord.every(check);
    }
    return false;
  };

  if (!("coordinates" in geometry)) return true; // GeometryCollection, dsb.
  return check(geometry.coordinates);
}

function hasSelfIntersection(geometry: Polygon | MultiPolygon): boolean {
  try {
    const feature = { type: "Feature", properties: {}, geometry } as Feature<
      Polygon | MultiPolygon
    >;
    const result = kinks(feature);
    return result.features.length > 0;
  } catch {
    // Geometry malformed sehingga turf gagal parse -> sudah tertangkap di hasValidCoordinates,
    // di sini cukup anggap tidak ada temuan self-intersection tambahan.
    return false;
  }
}
