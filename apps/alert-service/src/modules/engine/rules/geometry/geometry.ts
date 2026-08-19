export type LatLon = [number, number];
export type Polygon = LatLon[];

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const dLat = toRadians(b[0] - a[0]);
  const dLon = toRadians(b[1] - a[1]);
  const lat1 = toRadians(a[0]);
  const lat2 = toRadians(b[0]);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function pointInPolygon(point: LatLon, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-12) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentMeters(p: LatLon, a: LatLon, b: LatLon): number {
  // Project onto segment in meters using a local plane approximation.
  const dx = b[1] - a[1];
  const dy = b[0] - a[0];
  const ab = [dx, dy];
  const ap = [p[1] - a[1], p[0] - a[0]];

  const abLen2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (abLen2 === 0) return haversineMeters(p, a);

  let t = (ap[0] * ab[0] + ap[1] * ab[1]) / abLen2;
  t = Math.max(0, Math.min(1, t));

  const closest: LatLon = [a[0] + t * ab[1], a[1] + t * ab[0]];

  return haversineMeters(p, closest);
}

export function distanceToPolylineMeters(
  point: LatLon,
  polyline: Polygon,
): number {
  if (polyline.length === 0) return Number.POSITIVE_INFINITY;
  if (polyline.length === 1) return haversineMeters(point, polyline[0]);

  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = pointToSegmentMeters(point, polyline[i], polyline[i + 1]);
    if (d < min) min = d;
  }
  return min;
}
