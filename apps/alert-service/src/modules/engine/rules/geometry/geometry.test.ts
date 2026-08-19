import { describe, expect, test } from "bun:test";
import {
  distanceToPolylineMeters,
  haversineMeters,
  pointInPolygon,
} from "./geometry";

describe("geometry helpers", () => {
  test("haversineMeters for ~1 km", () => {
    const a: [number, number] = [-7.385, 112.77];
    const b: [number, number] = [-7.385, 112.779];
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(1100);
  });

  test("pointInPolygon identifies a point inside a square", () => {
    const square: [number, number][] = [
      [-7.4, 112.77],
      [-7.4, 112.8],
      [-7.38, 112.8],
      [-7.38, 112.77],
    ];
    expect(pointInPolygon([-7.39, 112.785], square)).toBe(true);
    expect(pointInPolygon([-7.41, 112.785], square)).toBe(false);
  });

  test("distanceToPolylineMeters for a point near a short line", () => {
    const line: [number, number][] = [
      [-7.385, 112.77],
      [-7.385, 112.78],
    ];
    const d = distanceToPolylineMeters([-7.386, 112.775], line);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(130);
  });
});
