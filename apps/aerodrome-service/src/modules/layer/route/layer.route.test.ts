import { beforeEach, describe, expect, it, mock } from "bun:test";

const passthroughMiddleware = async (
  _c: unknown,
  next: () => Promise<void>,
): Promise<void> => {
  await next();
};

import { FakeRedis } from "@repo/shared/testing/fakeRedis";

// Shared fake (packages/shared/src/testing/fakeRedis.ts) � mock.module is
// process-wide in bun test; all files must register the same fake.
mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

const authModule = await import("@repo/auth");

// Preserve real auth package exports; only override middleware so routes can be
// tested without a real database/user. Without the spread, other test files that
// import named helpers like `generateRefreshToken` from `@repo/auth` break because
// `mock.module` is process-global in bun:test.
mock.module("@repo/auth", () => ({
  ...authModule,
  authentication: passthroughMiddleware,
  rbacMiddleware: passthroughMiddleware,
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

const getLayers = mock();

mock.module("../service/layer.service", () => ({
  getLayers,
}));

const { default: layerRoute } = await import("./layer.route");

beforeEach(() => {
  getLayers.mockReset();
});

describe("GET /", () => {
  it("returns a list of layers wrapped in the ApiResponse envelope", async () => {
    getLayers.mockResolvedValue([
      { layer: "RUNWAY", featureCount: 2 },
      { layer: "TAXIWAY", featureCount: 5 },
    ]);

    const res = await layerRoute.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data).toHaveLength(2);
    expect(getLayers).toHaveBeenCalledWith({});
  });

  it("forwards the name query param to the service", async () => {
    getLayers.mockResolvedValue([{ layer: "RUNWAY", featureCount: 2 }]);

    await layerRoute.request("/?name=RUNWAY");

    expect(getLayers).toHaveBeenCalledWith({ name: "RUNWAY" });
  });

  it("returns 400 with a VALIDATION_ERROR for an invalid layer name", async () => {
    const res = await layerRoute.request("/?name=NOT_A_LAYER");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.meta.status).toBe("ERROR");
  });
});
