import { describe, expect, test } from "bun:test";
import { createFeatureSchema, updateFeatureSchema } from "./feature.validator";

const base = {
  layer: "TAXIWAY" as const,
  geometry: { type: "Point" as const, coordinates: [112.78, -7.38] },
};

describe("properties.color", () => {
  test("accepts a #RRGGBB colour or none", () => {
    expect(
      createFeatureSchema.safeParse({
        ...base,
        properties: { color: "#FFaa00" },
      }).success,
    ).toBe(true);
    expect(createFeatureSchema.safeParse({ ...base }).success).toBe(true);
  });

  test("rejects anything else, on create and on update", () => {
    for (const color of ["red", "#fff", "#GGGGGG", 12]) {
      expect(
        createFeatureSchema.safeParse({ ...base, properties: { color } })
          .success,
      ).toBe(false);
      expect(
        updateFeatureSchema.safeParse({ properties: { color } }).success,
      ).toBe(false);
    }
  });
});
