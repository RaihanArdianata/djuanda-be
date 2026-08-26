const METERS_PER_DEGREE_LAT = 111320;

const LINE_WIDTHS: Record<string, number | undefined> = {
  RUNWAY: 45,
  TAXIWAY: 22.5,
  AEROWAY: 30,
  ROAD: 8,
  BARRIER: 2,
};

function metersPerDegreeLon(latitude: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180);
}

function segmentVectorMeters(
  a: [number, number],
  b: [number, number],
): [number, number] {
  const mLon = metersPerDegreeLon(a[1]);
  const dx = (b[0] - a[0]) * mLon;
  const dy = (b[1] - a[1]) * METERS_PER_DEGREE_LAT;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [0, 0];
  return [dx / len, dy / len];
}

function leftNormal(v: [number, number]): [number, number] {
  return [-v[1], v[0]];
}

function applyMetersOffset(
  lon: number,
  lat: number,
  dxMeters: number,
  dyMeters: number,
): [number, number] {
  const dLat = dyMeters / METERS_PER_DEGREE_LAT;
  const dLon = dxMeters / metersPerDegreeLon(lat);
  return [lat + dLat, lon + dLon];
}

function averageNormals(parts: [number, number][]): [number, number] {
  const nx = parts.reduce((s, p) => s + p[0], 0) / parts.length;
  const ny = parts.reduce((s, p) => s + p[1], 0) / parts.length;
  const len = Math.hypot(nx, ny);
  if (len === 0) return parts[0] ?? [0, 0];
  return [nx / len, ny / len];
}

function collectNormalParts(
  coords: [number, number][],
  index: number,
): [number, number][] {
  const parts: [number, number][] = [];
  if (index > 0) {
    const v = segmentVectorMeters(coords[index - 1], coords[index]);
    const ln = leftNormal(v);
    if (ln[0] !== 0 || ln[1] !== 0) parts.push(ln);
  }
  if (index < coords.length - 1) {
    const v = segmentVectorMeters(coords[index], coords[index + 1]);
    const ln = leftNormal(v);
    if (ln[0] !== 0 || ln[1] !== 0) parts.push(ln);
  }
  return parts;
}

function computeNormals(coords: [number, number][]): [number, number][] {
  return coords.map((_, i) => {
    const parts = collectNormalParts(coords, i);
    if (parts.length === 0) return [0, 0];
    return averageNormals(parts);
  });
}

function buildRing(
  coords: [number, number][],
  normals: [number, number][],
  halfWidth: number,
): [number, number][] {
  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    const [nx, ny] = normals[i];
    left.push(applyMetersOffset(lon, lat, nx * halfWidth, ny * halfWidth));
    right.push(applyMetersOffset(lon, lat, -nx * halfWidth, -ny * halfWidth));
  }

  const ring = [...left, ...right.reverse()];
  if (ring.length > 0) ring.push(ring[0]);
  return ring;
}

function bufferLineString(
  coords: [number, number][],
  widthMeters: number,
): [number, number][] {
  if (coords.length < 2) return [];
  const normals = computeNormals(coords);
  return buildRing(coords, normals, widthMeters / 2);
}

function getLineBufferWidth(
  layer: string,
  properties: Record<string, unknown>,
): number | undefined {
  const widthFromProp =
    (properties?.width as number | undefined) ??
    (properties?.buffer as number | undefined);
  if (typeof widthFromProp === "number" && widthFromProp > 0) {
    return widthFromProp;
  }
  return LINE_WIDTHS[layer];
}

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

function extractPolygonFromLineString(
  geo: Record<string, unknown>,
  width: number,
): [number, number][] {
  const coords = (geo.coordinates as [number, number][]) ?? [];
  return bufferLineString(coords, width);
}

function extractPolygonFromMultiLineString(
  geo: Record<string, unknown>,
  width: number,
): [number, number][] {
  const lines = (geo.coordinates as [number, number][][]) ?? [];
  if (lines.length === 0) return [];
  return bufferLineString(lines[0], width);
}

export function extractPolygon(
  geometry: unknown,
  layer: string,
  properties: Record<string, unknown>,
): [number, number][] {
  const geo = geometry as Record<string, unknown>;
  const type = geo.type as string;
  const width = getLineBufferWidth(layer, properties);

  switch (type) {
    case "Polygon":
      return extractPolygonFromPolygon(geo);
    case "MultiPolygon":
      return extractPolygonFromMultiPolygon(geo);
    case "LineString":
      if (!width) return [];
      return extractPolygonFromLineString(geo, width);
    case "MultiLineString":
      if (!width) return [];
      return extractPolygonFromMultiLineString(geo, width);
    default:
      return [];
  }
}
