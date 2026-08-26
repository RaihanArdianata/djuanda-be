function ringToLatLon(ring: number[][]): [number, number][] {
  return ring.map(([lon, lat]) => [lat, lon]);
}

function extractPolygonFromPolygon(
  geo: Record<string, unknown>,
): [number, number][] {
  const rings = (geo.coordinates as number[][][])[0];
  if (!rings) return [];
  return ringToLatLon(rings);
}

function extractPolygonFromMultiPolygon(
  geo: Record<string, unknown>,
): [number, number][] {
  const polys = geo.coordinates as number[][][][];
  if (polys.length === 0) return [];
  const ring = polys[0][0];
  if (!ring) return [];
  return ringToLatLon(ring);
}

export function extractPolygon(
  geometry: unknown,
  _layer: string,
  _properties: Record<string, unknown>,
): [number, number][] {
  const geo = geometry as Record<string, unknown>;
  const type = geo.type as string;

  switch (type) {
    case "Polygon":
      return extractPolygonFromPolygon(geo);
    case "MultiPolygon":
      return extractPolygonFromMultiPolygon(geo);
    default:
      return [];
  }
}
