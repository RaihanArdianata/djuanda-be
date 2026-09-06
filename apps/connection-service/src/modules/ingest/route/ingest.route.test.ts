import { beforeEach, describe, expect, it, mock } from "bun:test";
import { FakeRedis } from "@repo/shared/src/testing/fakeRedis";

// The service snapshots these env vars into module-level constants at import
// time, so they must be set before the dynamic import below.
process.env.AEROSWARM_INGEST_SECRET = "test-ingest-secret";
process.env.AEROSWARM_AIRPORT_ID = "WARR";

// ioredis is pulled in transitively via @repo/shared's rate limiter (the
// barrel import instantiates a client at module load). Swap in the shared fake
// so the test never touches a real Redis at localhost:6379.
mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

// @repo/database opens a real Postgres pool at import time. The ingest flush
// only needs a chainable insert builder, so stub the whole module — this is
// what stands in for `enqueueIngestEvent`'s eventual DB write.
const returning = mock(() => Promise.resolve([]));
const onConflictDoUpdate = mock(() => ({ returning }));
const onConflictDoNothing = mock(() => Promise.resolve());
const values = mock(() => ({ onConflictDoNothing, onConflictDoUpdate }));
const insert = mock(() => ({ values }));

mock.module("@repo/database", () => ({
  db: { insert },
  aeroswarmTracks: {},
  aeroswarmAlerts: {},
  aeroswarmMovements: { trackId: {}, type: {}, at: {} },
}));

// Keep pino quiet during tests — the service logs on every code path.
const noop = (): void => {};
mock.module("@repo/logger", () => ({
  logger: { info: noop, warn: noop, error: noop, debug: noop },
}));

// Imported dynamically, after the mocks above are registered, so the route
// (via the controller and service) picks up the mocked externals and the env
// vars set at the top of this file.
const { default: ingestRoute } = await import("./ingest.route");
const { flush } = await import("../service/ingest.service");

const SECRET_HEADERS = {
  "content-type": "application/json",
  "x-aero-ingest-secret": "test-ingest-secret",
};

const postEvent = (
  body: unknown,
  headers: Record<string, string> = SECRET_HEADERS,
) =>
  ingestRoute.request("/", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

const trackEvent = {
  trackId: "track-1",
  airportId: "WARR",
  fusedAt: 1_752_000_000_000,
};

beforeEach(() => {
  insert.mockClear();
  values.mockClear();
  onConflictDoNothing.mockClear();
  onConflictDoUpdate.mockClear();
  returning.mockClear();
});

describe("POST / (ingest)", () => {
  it("rejects a missing x-aero-ingest-secret header with 401", async () => {
    const res = await postEvent(
      { event: trackEvent },
      { "content-type": "application/json" },
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
    expect(body.meta.status).toBe("ERROR");
  });

  it("rejects a wrong x-aero-ingest-secret header with 401", async () => {
    const res = await postEvent(
      { event: trackEvent },
      {
        "content-type": "application/json",
        "x-aero-ingest-secret": "wrong-secret",
      },
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 400 VALIDATION_ERROR when the envelope has no event object", async () => {
    const res = await postEvent({ notAnEvent: true });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields).toBeDefined();
  });

  it("returns 400 VALIDATION_ERROR for an unrecognized event shape", async () => {
    const res = await postEvent({ event: { foo: "bar" } });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("Unrecognized event shape");
  });

  it("returns 400 VALIDATION_ERROR when the event airportId doesn't match AEROSWARM_AIRPORT_ID", async () => {
    const res = await postEvent({
      event: { ...trackEvent, airportId: "WAAA" },
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("does not match");
  });

  it("accepts a valid track event and returns 202 Accepted immediately", async () => {
    const res = await postEvent({ event: trackEvent });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ kind: "track" });
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.meta.message).toBe("event enqueued");

    // The controller now returns 202 without awaiting the 500ms buffer flush,
    // so flush the buffer explicitly before asserting the DB was written.
    await flush();
    expect(insert).toHaveBeenCalled();
  });

  it("accepts a valid movement event and flushes it via the upsert path", async () => {
    const res = await postEvent({
      event: {
        trackId: "track-2",
        airportId: "WARR",
        type: "takeoff",
        at: 1_752_000_000_000,
        lat: -7.38,
        lon: 112.79,
      },
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.data).toEqual({ kind: "movement" });

    await flush();
    expect(onConflictDoUpdate).toHaveBeenCalled();
  });
});
