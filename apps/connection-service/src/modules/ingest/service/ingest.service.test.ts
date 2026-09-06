import { describe, expect, it, mock } from "bun:test";
import { FakeRedis } from "@repo/shared/src/testing/fakeRedis";

// The service snapshots these env vars into module-level constants at import
// time, so they must be set before the dynamic import below.
process.env.AEROSWARM_INGEST_SECRET = "test-ingest-secret";
process.env.AEROSWARM_AIRPORT_ID = "WARR";

// @repo/shared's barrel pulls in the rate limiter, which instantiates an
// ioredis client at module load. Swap in the shared fake so no real Redis
// connection is attempted.
mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

// @repo/database opens a real Postgres pool at import time; the pure helpers
// under test never touch it, so stub the whole module.
mock.module("@repo/database", () => ({
  db: { insert: mock() },
  aeroswarmTracks: {},
  aeroswarmAlerts: {},
  aeroswarmMovements: {},
}));

// Keep pino quiet during tests.
const noop = (): void => {};
mock.module("@repo/logger", () => ({
  logger: { info: noop, warn: noop, error: noop, debug: noop },
}));

// Imported dynamically, after the mocks above are registered and the env
// vars are set, so the module snapshots the test configuration.
const {
  AirportMismatchError,
  assertExpectedAirport,
  getIngestEventIdentity,
  getIngestLogKind,
  isAlertEvent,
  isMovementEvent,
  isTrackEvent,
  isValidIngestSecret,
} = await import("./ingest.service");

describe("isValidIngestSecret", () => {
  it("accepts the configured secret", () => {
    expect(isValidIngestSecret("test-ingest-secret")).toBe(true);
  });

  it("rejects missing, empty, or wrong secrets", () => {
    expect(isValidIngestSecret(null)).toBe(false);
    expect(isValidIngestSecret(undefined)).toBe(false);
    expect(isValidIngestSecret("")).toBe(false);
    expect(isValidIngestSecret("wrong")).toBe(false);
  });
});

describe("event type guards", () => {
  it("isTrackEvent requires a string trackId and numeric fusedAt", () => {
    expect(isTrackEvent({ trackId: "t1", fusedAt: 123 })).toBe(true);
    expect(isTrackEvent({ trackId: "t1" })).toBe(false);
    expect(isTrackEvent({ fusedAt: 123 })).toBe(false);
    expect(isTrackEvent({ trackId: 1, fusedAt: "x" })).toBe(false);
    expect(isTrackEvent(null)).toBe(false);
  });

  it("isAlertEvent requires a string alertId and numeric triggeredAt", () => {
    expect(isAlertEvent({ alertId: "a1", triggeredAt: 123 })).toBe(true);
    expect(isAlertEvent({ alertId: "a1" })).toBe(false);
    expect(isAlertEvent({ triggeredAt: 123 })).toBe(false);
    expect(isAlertEvent(null)).toBe(false);
  });

  it("isMovementEvent requires trackId, takeoff/landing type, and numeric at", () => {
    expect(isMovementEvent({ trackId: "t1", type: "takeoff", at: 123 })).toBe(
      true,
    );
    expect(isMovementEvent({ trackId: "t1", type: "landing", at: 123 })).toBe(
      true,
    );
    expect(isMovementEvent({ trackId: "t1", type: "taxi", at: 123 })).toBe(
      false,
    );
    expect(isMovementEvent({ trackId: "t1", type: "takeoff" })).toBe(false);
    expect(isMovementEvent(null)).toBe(false);
  });
});

describe("getIngestLogKind", () => {
  it("classifies track, alert, movement, and unknown events", () => {
    expect(getIngestLogKind({ trackId: "t", fusedAt: 1 })).toBe("track");
    expect(getIngestLogKind({ alertId: "a", triggeredAt: 1 })).toBe("alert");
    expect(getIngestLogKind({ trackId: "t", type: "takeoff", at: 1 })).toBe(
      "movement",
    );
    expect(getIngestLogKind({ foo: 1 })).toBe("unknown");
    expect(getIngestLogKind(null)).toBe("unknown");
  });
});

describe("getIngestEventIdentity", () => {
  it("prefers trackId over alertId and surfaces airportId", () => {
    expect(
      getIngestEventIdentity({
        trackId: "t1",
        alertId: "a1",
        airportId: "WARR",
      }),
    ).toEqual({ id: "t1", airportId: "WARR" });
    expect(getIngestEventIdentity({ alertId: "a1" })).toEqual({
      id: "a1",
      airportId: undefined,
    });
    expect(getIngestEventIdentity(null)).toEqual({});
    expect(getIngestEventIdentity("nope")).toEqual({});
  });
});

describe("assertExpectedAirport", () => {
  it("passes when the event airportId matches AEROSWARM_AIRPORT_ID", () => {
    expect(() => assertExpectedAirport({ airportId: "WARR" })).not.toThrow();
  });

  it("throws AirportMismatchError when the airportId differs or is missing", () => {
    expect(() => assertExpectedAirport({ airportId: "WAAA" })).toThrow(
      AirportMismatchError,
    );
    expect(() => assertExpectedAirport({})).toThrow(AirportMismatchError);
    try {
      assertExpectedAirport({ airportId: "WAAA" });
    } catch (err) {
      expect(err).toBeInstanceOf(AirportMismatchError);
      expect((err as Error).message).toContain("WAAA");
      expect((err as Error).message).toContain("WARR");
    }
  });
});
