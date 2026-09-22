import { beforeEach, describe, expect, it, mock } from "bun:test";
import { FakeRedis } from "@repo/shared/testing/fakeRedis";

const passthroughMiddleware = async (
  _c: unknown,
  next: () => Promise<void>,
): Promise<void> => {
  await next();
};

mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

const authModule = await import("@repo/auth");
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

const mockGetAlertsForExport = mock();

const realRepo = await import("../repository/alert.repository");
mock.module("../repository/alert.repository", () => ({
  ...realRepo,
  getAlertsForExport: mockGetAlertsForExport,
}));

const { default: alertRoute } = await import("./alert.route");

beforeEach(() => {
  mockGetAlertsForExport.mockReset();
});

describe("GET /export (Alert Data Export)", () => {
  it("should return 400 when format is missing or invalid", async () => {
    const res = await alertRoute.request(
      "/export?format=pdf&startDateTime=2026-07-27T00:00:00Z&endDateTime=2026-07-27T23:59:59Z",
    );
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.meta.status).toBe("ERROR");
  });

  it("should return 400 when startDateTime or endDateTime is missing", async () => {
    const res = await alertRoute.request("/export?format=csv");
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("should return 400 with INVALID_DATE_RANGE when startDateTime >= endDateTime", async () => {
    const res = await alertRoute.request(
      "/export?format=csv&startDateTime=2026-07-28T00:00:00Z&endDateTime=2026-07-27T00:00:00Z",
    );
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("INVALID_DATE_RANGE");
    expect(body.error.message).toBe("Start date must be before end date");
    expect(body.meta.code).toBe(400);
    expect(body.meta.status).toBe("ERROR");
  });

  it("should return 200 and CSV stream when format is csv", async () => {
    mockGetAlertsForExport.mockResolvedValue([
      {
        alertId: "alert_001",
        type: "RUNWAY_INCURSION",
        trackId: "track_001",
        airportId: "WARR",
        status: "ACTIVE",
        severity: "HIGH",
        triggeredAt: new Date("2026-07-27T10:00:00Z"),
        data: { callsign: "BTK6526", icao24: "8a0515" },
      },
    ]);

    const res = await alertRoute.request(
      "/export?format=csv&startDateTime=2026-07-27T00:00:00Z&endDateTime=2026-07-27T23:59:59Z",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="alerts_20260727_20260727.csv"',
    );

    const text = await res.text();
    expect(text).toContain(
      "Alert ID,Alert Type,Aircraft / Track ID,Callsign,ICAO24,Airport,Detected At,Status,Severity",
    );
    expect(text).toContain(
      "alert_001,RUNWAY_INCURSION,track_001,BTK6526,8a0515,WARR",
    );
  });

  it("should return 200 and XLSX binary stream when format is xlsx", async () => {
    mockGetAlertsForExport.mockResolvedValue([
      {
        alertId: "alert_002",
        type: "STCA",
        trackId: "track_002",
        airportId: "WARR",
        status: "ACTIVE",
        severity: "MEDIUM",
        triggeredAt: new Date("2026-07-27T11:00:00Z"),
        data: { callsign: "GIA123", icao24: "8a1234" },
      },
    ]);

    const res = await alertRoute.request(
      "/export?format=xlsx&startDateTime=2026-07-27T00:00:00Z&endDateTime=2026-07-28T23:59:59Z",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="alerts_20260727_20260728.xlsx"',
    );

    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBeGreaterThan(0);
  });
});
