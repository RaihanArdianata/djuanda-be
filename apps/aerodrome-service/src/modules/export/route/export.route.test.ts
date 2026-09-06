import { beforeEach, describe, expect, it, mock } from "bun:test";

const passthroughMiddleware = async (
  _c: unknown,
  next: () => Promise<void>,
): Promise<void> => {
  await next();
};

mock.module("@repo/auth-service/src/middleware/auth.middleware", () => ({
  authentication: passthroughMiddleware,
  rbacMiddleware: passthroughMiddleware,
}));

import { FakeRedis } from "@repo/shared/src/testing/fakeRedis";

// Shared fake (packages/shared/src/testing/fakeRedis.ts) — mock.module is
// process-wide in bun test; all files must register the same fake.
mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

class FakeKafka {
  producer() {
    return {
      connect: mock(),
      send: mock(),
      disconnect: mock(),
    };
  }
  consumer() {
    return {
      connect: mock(),
      subscribe: mock(),
      run: mock(),
      on: mock(),
      disconnect: mock(),
    };
  }
}

mock.module("kafkajs", () => ({
  Kafka: FakeKafka,
}));

mock.module("@repo/database", () => ({
  LAYER_VALUES: [
    "AERODROME",
    "AEROWAY",
    "RUNWAY",
    "TAXIWAY",
    "APRON",
    "RESTRICTED",
    "TERMINAL",
    "PARKING",
    "BUILDING",
    "WATCH_TOWER",
    "POINT_OF_INTEREST",
    "GRASS",
    "GARDEN",
    "WATER",
    "ROAD",
    "BARRIER",
    "MILITARY",
    "OTHER",
  ],
  FEATURE_STATUS_VALUES: ["ACTIVE", "INACTIVE", "RESTRICTED"],
  db: {},
  aerodromeFeatures: {},
  aeroswarmAlerts: {},
  aeroswarmMovements: {},
  aerodromeFeaturesSelectSchema: {},
}));

const getAerodromeExport = mock();

mock.module("../service/export.service", () => ({
  getAerodromeExport,
}));

const { default: exportRoute } = await import("./export.route");

beforeEach(() => {
  getAerodromeExport.mockReset();
});

describe("GET /", () => {
  it("returns the exported GeoJSON feature collection", async () => {
    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          geometry: { type: "Point", coordinates: [112.0, -7.8] },
          properties: { layer: "RUNWAY", name: "Runway 10/28" },
        },
      ],
    };

    getAerodromeExport.mockResolvedValue(geojson);

    const res = await exportRoute.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data.type).toBe("FeatureCollection");
    expect(body.data.features).toHaveLength(1);
  });
});
