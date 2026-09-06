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

const getMovements = mock();

mock.module("../service/movement.service", () => ({
  getMovements,
}));

const { default: movementRoute } = await import("./movement.route");

const sampleMovement = {
  id: "track-1-takeoff-2026-07-01T06:00:00.000Z",
  trackId: "track-1",
  callsign: "GIA123",
  icao24: "123456",
  airportId: "WARR",
  type: "TAKE_OFF",
  eventTime: "2026-07-01T06:00:00.000Z",
};

beforeEach(() => {
  getMovements.mockReset();
});

describe("GET /", () => {
  it("returns a list of aircraft movements", async () => {
    getMovements.mockResolvedValue([sampleMovement]);

    const res = await movementRoute.request(
      "/?type=TAKE_OFF&airportId=WARR&startDateTime=2026-07-01T00:00:00Z&endDateTime=2026-07-02T00:00:00Z",
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data).toHaveLength(1);
    expect(getMovements).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "TAKE_OFF",
        airportId: "WARR",
      }),
    );
  });

  it("returns 400 with a VALIDATION_ERROR for an invalid movement type", async () => {
    const res = await movementRoute.request("/?type=HOVER");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.meta.status).toBe("ERROR");
  });

  it("returns 400 with a VALIDATION_ERROR when startDateTime is after endDateTime", async () => {
    const res = await movementRoute.request(
      "/?startDateTime=2026-07-02T00:00:00Z&endDateTime=2026-07-01T00:00:00Z",
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
