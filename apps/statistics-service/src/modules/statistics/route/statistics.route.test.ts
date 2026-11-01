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

const getOperationalStatistics = mock();

mock.module("../service/statistics.service", () => ({
  getOperationalStatistics,
}));

import { sampleReportResult } from "../lib/report-fixture";

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

describe("GET /operational/export", () => {
  it("returns the Excel report as a downloadable xlsx file", async () => {
    getOperationalStatistics.mockResolvedValue(sampleReportResult());

    const res = await statisticsRoute.request(
      "/operational/export?period=daily&startDate=2026-11-01&endDate=2026-11-02&severity=CRITICAL",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="laporan_statistik_bandara_daily_2026-11-01_2026-11-02.xlsx"',
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    // An xlsx is a zip archive: it starts with "PK".
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe("PK");
    expect(getOperationalStatistics).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "CRITICAL" }),
    );
  });

  it("rejects a start date after the end date", async () => {
    const res = await statisticsRoute.request(
      "/operational/export?period=daily&startDate=2026-11-05&endDate=2026-11-02",
    );
    expect(res.status).toBe(400);
    expect(getOperationalStatistics).not.toHaveBeenCalled();
  });

  it("validates the query like the JSON endpoint does", async () => {
    const res = await statisticsRoute.request(
      "/operational/export?period=yearly&startDate=2026-11-01&endDate=2026-11-02",
    );
    expect(res.status).toBe(400);
  });
});
