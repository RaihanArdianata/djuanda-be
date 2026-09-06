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

const getOperationalStatistics = mock();

mock.module("../service/statistics.service", () => ({
  getOperationalStatistics,
}));

const { default: statisticsRoute } = await import("./statistics.route");

const sampleOperationalStatistics = {
  period: "daily",
  startDate: "2026-07-01",
  endDate: "2026-07-02",
  traffic: {
    totalAircraft: 10,
    totalGroundVehicle: 0,
    totalTraffic: 10,
  },
  movement: {
    totalTakeoff: 5,
    totalLanding: 5,
    averageMovementPerHour: 0.42,
    peakHourMovement: 2,
    peakHour: "2026-07-01T08:00",
  },
  alerts: {
    stca: 0,
    apa: 0,
    da: 0,
    ria: 0,
    taia: 0,
    total: 0,
  },
  trend: [],
};

beforeEach(() => {
  getOperationalStatistics.mockReset();
});

describe("GET /operational", () => {
  it("returns operational statistics wrapped in the ApiResponse envelope", async () => {
    getOperationalStatistics.mockResolvedValue(sampleOperationalStatistics);

    const res = await statisticsRoute.request(
      "/operational?period=daily&startDate=2026-07-01&endDate=2026-07-02&airportId=WARR",
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data.period).toBe("daily");
    expect(getOperationalStatistics).toHaveBeenCalledWith(
      expect.objectContaining({
        period: "daily",
        startDate: "2026-07-01",
        endDate: "2026-07-02",
        airportId: "WARR",
      }),
    );
  });

  it("returns 400 with a VALIDATION_ERROR when required query params are missing", async () => {
    const res = await statisticsRoute.request("/operational");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.meta.status).toBe("ERROR");
  });

  it("returns 400 with a VALIDATION_ERROR for an invalid period", async () => {
    const res = await statisticsRoute.request(
      "/operational?period=yearly&startDate=2026-07-01&endDate=2026-07-02",
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
