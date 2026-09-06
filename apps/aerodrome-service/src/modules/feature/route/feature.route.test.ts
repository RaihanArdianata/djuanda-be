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

const listFeatures = mock();
const getFeatureById = mock();
const createFeature = mock();
const updateFeature = mock();
const deleteFeature = mock();

mock.module("../service/feature.service", () => ({
  listFeatures,
  getFeatureById,
  createFeature,
  updateFeature,
  deleteFeature,
}));

const { ApiError } = await import("@repo/shared");
const { default: featureRoute } = await import("./feature.route");

const sampleFeature = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  airportId: "WARR",
  layer: "RUNWAY",
  name: "Runway 10/28",
  status: "ACTIVE",
  geometry: { type: "Point", coordinates: [112.0, -7.8] },
  properties: {},
  createdAt: "2026-07-08T05:00:00.000Z",
  updatedAt: "2026-07-08T05:00:00.000Z",
};

beforeEach(() => {
  listFeatures.mockReset();
  getFeatureById.mockReset();
  createFeature.mockReset();
  updateFeature.mockReset();
  deleteFeature.mockReset();
});

describe("GET /", () => {
  it("returns a paginated list of features", async () => {
    listFeatures.mockResolvedValue({
      items: [sampleFeature],
      total: 1,
      page: 1,
      limit: 50,
    });

    const res = await featureRoute.request("/?layer=RUNWAY&airportId=WARR");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data.items).toHaveLength(1);
    expect(listFeatures).toHaveBeenCalledWith(
      expect.objectContaining({ layer: "RUNWAY", airportId: "WARR" }),
    );
  });

  it("returns 400 with a VALIDATION_ERROR for an invalid layer", async () => {
    const res = await featureRoute.request("/?layer=BOGUS");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /:id", () => {
  it("returns a single feature by id", async () => {
    getFeatureById.mockResolvedValue(sampleFeature);

    const res = await featureRoute.request(
      "/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data.id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(getFeatureById).toHaveBeenCalledWith(
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
  });

  it("returns 404 with a NOT_FOUND error when the feature does not exist", async () => {
    getFeatureById.mockRejectedValue(
      new ApiError("NOT_FOUND", { message: "Feature not found" }),
    );

    const res = await featureRoute.request("/missing-id");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
