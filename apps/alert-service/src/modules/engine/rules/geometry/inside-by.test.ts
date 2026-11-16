import { describe, expect, test } from "bun:test";
import { insideBy } from "./geometry";

describe("insideBy", () => {
  const square: [number, number][] = [
    [-7.38, 112.77],
    [-7.38, 112.8],
    [-7.37, 112.8],
    [-7.37, 112.77],
  ];

  test("a point well inside the polygon is inside by any small margin", () => {
    expect(insideBy([-7.375, 112.785], square, 10)).toBe(true);
  });

  test("a point just inside the edge is not inside by a margin larger than its distance", () => {
    // About 5 m inside the southern edge.
    const nearEdge: [number, number] = [-7.38 + 5 / 111_320, 112.785];
    expect(insideBy(nearEdge, square, 0)).toBe(true);
    expect(insideBy(nearEdge, square, 3)).toBe(true);
    expect(insideBy(nearEdge, square, 20)).toBe(false);
  });

  test("a point outside is never inside", () => {
    expect(insideBy([-7.4, 112.785], square, 0)).toBe(false);
  });

  test("works whether or not the ring is closed", () => {
    const closed = [...square, square[0] as [number, number]];
    const nearEdge: [number, number] = [-7.38 + 5 / 111_320, 112.785];
    expect(insideBy(nearEdge, closed, 20)).toBe(false);
    expect(insideBy(nearEdge, closed, 3)).toBe(true);
  });
});
