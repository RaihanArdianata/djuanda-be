import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { CurrentTrack } from "@aeroswarm/core/types";
import { createTrailStore } from "@aeroswarm/live-server";
import { Hono } from "hono";
import trailRoute, { parseTrailQuery, registerTrailRoute } from "./trail.route";
import { createTrailService } from "./trail-service";

const app = new Hono().route("/aero", trailRoute);
const TOKEN = "route-test-token-0123456789";
const authenticate = (token: string | null): boolean => token === TOKEN;

const T0 = Date.UTC(2026, 10, 1, 4, 15, 30);
const LAT = -7.38;
const LON = 112.78;
const eastOf = (m: number): number =>
  LON + m / (111_320 * Math.cos((LAT * Math.PI) / 180));

function track(m: number, s: number): CurrentTrack {
  return {
    trackId: "t1",
    source: "ASTERIX_CAT021",
    icao24: "8a0f21",
    callsign: "GIA123",
    squawk: null,
    lat: LAT,
    lon: eastOf(m),
    altitudeFt: 1000,
    groundSpeedKt: 120,
    headingDeg: 90,
    verticalRateFpm: 0,
    confidence: 1,
    lastSeenAt: T0 + s * 1000,
    status: "active",
  };
}

function register(over: { labelEveryMs?: number; defaultLimit?: number } = {}) {
  const trail = createTrailStore({ minDistanceM: 10 });
  for (let s = 0; s <= 340; s += 10) trail.record(track(s * 60, s)); // 04:15:30 - 04:21:10
  registerTrailRoute({
    authenticate,
    service: createTrailService({
      trail,
      minDistanceM: 10,
      backfillMs: 0,
      startedAt: 0,
    }),
    labelEveryMs: over.labelEveryMs ?? 120_000,
    defaultLimit: over.defaultLimit ?? 5_000,
  });
}

const get = (path: string, token: string | null = TOKEN) =>
  app.request(
    `/aero${path}`,
    token ? { headers: { authorization: `Bearer ${token}` } } : {},
  );

beforeAll(() => register());
afterEach(() => register());

describe("GET /aero/tracks/:trackId/trail", () => {
  it("answers with the standard envelope: a GeoJSON line plus a mark per two minutes, labels in the time zone asked for", async () => {
    const res = await get("/tracks/t1/trail?tz=Asia/Jakarta");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        type: string;
        features: Array<{
          properties: { kind: string; label?: string };
          geometry: { type: string; coordinates: unknown[] };
        }>;
      };
      meta: { serverTime: number; count: number; truncated: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.data.type).toBe("FeatureCollection");
    const [line, ...marks] = body.data.features;
    expect(line?.geometry.type).toBe("LineString");
    expect(line?.geometry.coordinates.length).toBe(body.meta.count);
    expect(marks.map((m) => m.properties.label)).toEqual([
      "01-11-26 11:16",
      "01-11-26 11:18",
      "01-11-26 11:20",
    ]);
    expect(typeof body.meta.serverTime).toBe("number");
    expect(body.meta.truncated).toBe(false);
  });

  it("is UTC when no time zone is given, and labelFormat 'time' gives HH:mm", async () => {
    const utc = (await (await get("/tracks/t1/trail")).json()) as {
      data: { features: Array<{ properties: { label?: string } }> };
    };
    expect(utc.data.features[1]?.properties.label).toBe("01-11-26 04:16");
    const time = (await (
      await get("/tracks/t1/trail?labelFormat=time&labelEveryMs=60000")
    ).json()) as {
      data: { features: Array<{ properties: { label?: string } }> };
    };
    expect(time.data.features.slice(1).map((f) => f.properties.label)).toEqual([
      "04:16",
      "04:17",
      "04:18",
      "04:19",
      "04:20",
      "04:21",
    ]);
  });

  it("sinceMs returns only what is newer, for cheap polling", async () => {
    const all = (await (await get("/tracks/t1/trail")).json()) as {
      data: {
        features: Array<{
          properties: { to?: number };
          geometry: { coordinates: unknown[] };
        }>;
      };
    };
    const to = all.data.features[0]?.properties.to as number;
    const delta = (await (
      await get(`/tracks/t1/trail?sinceMs=${to - 60_000}`)
    ).json()) as {
      data: { features: Array<{ geometry: { coordinates: unknown[] } }> };
      meta: { count: number };
    };
    expect(delta.meta.count).toBeLessThan(
      (all.data.features[0]?.geometry.coordinates.length as number) / 3,
    );
    expect(delta.meta.count).toBeGreaterThan(0);
  });

  it("format=points gives columns; limit thins and says so", async () => {
    const cols = (await (
      await get("/tracks/t1/trail?format=points&limit=5")
    ).json()) as {
      data: { t: number[]; lat: number[] };
      meta: { count: number; truncated: boolean };
    };
    expect(cols.data.t).toHaveLength(5);
    expect(cols.meta).toMatchObject({ count: 5, truncated: true });
  });

  it("uses the configured default limit and mark interval when the request does not say", async () => {
    register({ defaultLimit: 4, labelEveryMs: 0 });
    const body = (await (await get("/tracks/t1/trail")).json()) as {
      data: { features: unknown[] };
      meta: { count: number };
    };
    expect(body.meta.count).toBe(4);
    expect(body.data.features).toHaveLength(1); // no marks
  });

  it("an unknown track is 404 NOT_FOUND in the standard error shape", async () => {
    const res = await get("/tracks/nobody/trail");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "no trail for track nobody",
        recoverable: false,
      },
    });
  });

  it("needs a token: none or a wrong one is 401 UNAUTHORIZED; ?token= works like the header", async () => {
    for (const res of [
      await get("/tracks/t1/trail", null),
      await get("/tracks/t1/trail", "wrong-token"),
    ]) {
      expect(res.status).toBe(401);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("UNAUTHORIZED");
    }
    expect(
      (await app.request(`/aero/tracks/t1/trail?token=${TOKEN}`)).status,
    ).toBe(200);
  });

  it("a bad parameter is 400 BAD_REQUEST and names it", async () => {
    for (const [q, word] of [
      ["fromMs=abc", "fromMs"],
      ["limit=1", "limit"],
      ["limit=99999999", "limit"],
      ["stepM=-1", "stepM"],
      ["tz=Not/AZone", "tz"],
      ["format=xml", "format"],
      ["labelFormat=weird", "labelFormat"],
      ["fromMs=200&toMs=100", "fromMs"],
      ["sinceMs=1&fromMs=2", "sinceMs"],
    ] as const) {
      const res = await get(`/tracks/t1/trail?${q}`);
      expect(res.status, q).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("BAD_REQUEST");
      expect(body.error.message, q).toContain(word);
    }
  });

  it("a service that throws is INTERNAL without leaking the cause", async () => {
    registerTrailRoute({
      authenticate,
      service: {
        get: async () => {
          throw new Error("password=hunter2");
        },
      },
      labelEveryMs: 0,
      defaultLimit: 10,
    });
    const res = await get("/tracks/t1/trail");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("INTERNAL");
    expect(text).not.toContain("hunter2");
  });

  it("is 503 UNAVAILABLE while trails are not enabled", async () => {
    registerTrailRoute(null);
    const res = await get("/tracks/t1/trail");
    expect(res.status).toBe(503);
    expect(
      ((await res.json()) as { error: { recoverable: boolean } }).error
        .recoverable,
    ).toBe(true);
  });
});

describe("parseTrailQuery", () => {
  const d = { labelEveryMs: 120_000, defaultLimit: 5_000 };

  it("takes epoch ms or an ISO date for a time", () => {
    const a = parseTrailQuery(
      { fromMs: "1730434560000", toMs: "2026-11-01T04:30:00Z" },
      d,
    );
    expect(a.ok && a.request.query).toMatchObject({
      fromMs: 1730434560000,
      toMs: Date.UTC(2026, 10, 1, 4, 30),
    });
  });

  it("fills in the defaults", () => {
    const a = parseTrailQuery({}, d);
    expect(a).toEqual({
      ok: true,
      request: {
        query: {
          fromMs: undefined,
          toMs: undefined,
          sinceMs: undefined,
          stepM: undefined,
          limit: 5_000,
        },
        format: "geojson",
        labelFormat: "datetime",
        tz: "UTC",
        labelEveryMs: 120_000,
      },
    });
  });

  it("an empty value counts as absent", () => {
    expect(parseTrailQuery({ fromMs: "", limit: "", tz: "" }, d).ok).toBe(true);
  });
});
