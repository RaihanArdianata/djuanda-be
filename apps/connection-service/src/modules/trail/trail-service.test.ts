import { describe, expect, it } from "bun:test";
import type { CurrentTrack } from "@aeroswarm/core/types";
import { createTrailStore, type TrailStore } from "@aeroswarm/live-server";
import type {
  TrackHistoryPoint,
  TrackTrailQuery,
} from "@aeroswarm/replay-server";
import { createTrailService, type TrailServiceOptions } from "./trail-service";

const T0 = Date.UTC(2026, 10, 1, 4, 0, 0);
const LAT = -7.38;
const LON = 112.78;
const M_PER_DEG = 111_320;
const eastOf = (m: number): number =>
  LON + m / (M_PER_DEG * Math.cos((LAT * Math.PI) / 180));

/** A track `m` metres east of the start, `s` seconds after T0 plus `base` ms. */
function track(m: number, s: number, id = "a", base = 0): CurrentTrack {
  return {
    trackId: id,
    source: "ASTERIX_CAT021",
    icao24: "8a0f21",
    callsign: null,
    squawk: null,
    lat: LAT,
    lon: eastOf(m),
    altitudeFt: 1000,
    groundSpeedKt: 120,
    headingDeg: 90,
    verticalRateFpm: 0,
    confidence: 1,
    lastSeenAt: T0 + base + s * 1000,
    status: "active",
  };
}

/** A stored row: `m` metres east, `s` seconds after T0. */
const row = (m: number, s: number): TrackHistoryPoint => ({
  t: T0 + s * 1000,
  lat: LAT,
  lon: eastOf(m),
  altFt: 900,
  speedKt: 110,
  headingDeg: 90,
});

function fakeHistory(
  rows: TrackHistoryPoint[] | (() => Promise<TrackHistoryPoint[]>),
) {
  const calls: TrackTrailQuery[] = [];
  return {
    calls,
    trackTrail: async (q: TrackTrailQuery): Promise<TrackHistoryPoint[]> => {
      calls.push(q);
      return typeof rows === "function" ? rows() : rows;
    },
  };
}

function setup(
  over: Partial<TrailServiceOptions> = {},
  fill?: (trail: TrailStore) => void,
) {
  const trail = createTrailStore({ minDistanceM: 100 });
  fill?.(trail);
  const service = createTrailService({
    trail,
    minDistanceM: 100,
    backfillMs: 0,
    startedAt: T0 - 3_600_000,
    icao24Of: () => "8a0f21",
    ...over,
  });
  return { trail, service };
}

/** A flight of `seconds` seconds, 60 m/s, a report every second. */
const flight =
  (seconds: number, base = 0) =>
  (trail: TrailStore) => {
    for (let s = 0; s <= seconds; s++)
      trail.record(track(s * 60, s, "a", base));
  };

describe("memory answers", () => {
  it("from memory, without touching the database", async () => {
    const history = fakeHistory([]);
    const { service } = setup({ history }, flight(100));
    const a = await service.get("a", {});
    expect(a?.source).toBe("memory");
    expect(a?.slice.points.length).toBeGreaterThan(40);
    expect(history.calls).toEqual([]);
  });

  it("applies the query: a period, a coarser spacing, a limit", async () => {
    const { service } = setup({}, flight(100));
    const period = await service.get("a", {
      fromMs: T0 + 20_000,
      toMs: T0 + 40_000,
    });
    expect(period?.slice.points[0]?.t).toBeGreaterThanOrEqual(T0 + 20_000);
    expect(period?.slice.points.at(-1)?.t).toBeLessThanOrEqual(T0 + 40_000);
    expect((await service.get("a", { stepM: 1_000 }))?.slice.stepM).toBe(1_000);
    const limited = await service.get("a", { limit: 10 });
    expect(limited?.slice.points).toHaveLength(10);
    expect(limited?.slice.truncated).toBe(true);
  });

  it("sinceMs is memory only: polling never reaches the database", async () => {
    const history = fakeHistory([row(0, -100)]);
    const { service } = setup(
      { history, backfillMs: 3_600_000, startedAt: T0 - 1_000 },
      flight(100),
    );
    const a = await service.get("a", { sinceMs: T0 + 50_000 });
    expect(a?.source).toBe("memory");
    expect(a?.slice.points[0]?.t).toBeGreaterThan(T0 + 50_000);
    expect(history.calls).toEqual([]);
  });

  it("an unknown track with no database is simply unknown", async () => {
    const { service } = setup();
    expect(await service.get("nope", {})).toBeUndefined();
  });
});

describe("memory has nothing for the track: the database answers", () => {
  const rows = Array.from({ length: 200 }, (_, i) => row(i * 60, i));

  it("rebuilds the trail from stored points, cut to the usual spacing", async () => {
    const history = fakeHistory(rows);
    const { service } = setup({ history });
    const a = await service.get("gone", {});
    expect(a?.source).toBe("database");
    expect(history.calls[0]).toMatchObject({ trackId: "gone" });
    expect(a?.slice.points.length).toBeGreaterThan(80); // 200 stored, one every ~120 m
    expect(a?.slice.points.length).toBeLessThan(120);
    expect(a?.slice.fromStart).toBe(true);
  });

  it("honours stepM and limit on the rebuilt trail", async () => {
    const { service } = setup({ history: fakeHistory(rows) });
    expect(
      (await service.get("gone", { stepM: 1_000 }))?.slice.points.length,
    ).toBeLessThan(20);
    expect(
      (await service.get("gone", { limit: 7 }))?.slice.points,
    ).toHaveLength(7);
  });

  it("passes the period on, and for sinceMs asks only for what is newer", async () => {
    const history = fakeHistory(rows);
    const { service } = setup({ history });
    await service.get("gone", { fromMs: T0 + 10_000, toMs: T0 + 20_000 });
    expect(history.calls[0]).toMatchObject({
      fromMs: T0 + 10_000,
      toMs: T0 + 20_000,
    });
    await service.get("gone", { sinceMs: T0 + 30_000 });
    expect(history.calls[1]?.fromMs).toBe(T0 + 30_001);
    expect(
      (await service.get("gone", { fromMs: T0 + 1 }))?.slice.fromStart,
    ).toBe(false);
  });

  it("points without a position are skipped", async () => {
    const holes: TrackHistoryPoint[] = [
      { ...row(0, 0), lat: null },
      row(60, 1),
      { ...row(120, 2), lon: null },
      row(300, 5),
    ];
    const a = await createTrailService({
      trail: createTrailStore(),
      history: fakeHistory(holes),
      minDistanceM: 10,
      backfillMs: 0,
      startedAt: 0,
    }).get("x", {});
    expect(a?.slice.points).toHaveLength(2);
  });

  it("is unknown when the database has nothing, has no trackTrail, or fails", async () => {
    expect(
      await setup({ history: fakeHistory([]) }).service.get("gone", {}),
    ).toBeUndefined();
    expect(
      await setup({ history: {} }).service.get("gone", {}),
    ).toBeUndefined();
    const failing = fakeHistory(async () => {
      throw new Error("db down");
    });
    expect(
      await setup({ history: failing }).service.get("gone", {}),
    ).toBeUndefined();
  });
});

describe("the part before a restart", () => {
  // The process started at T0; the aircraft was already in the air, so memory's trail begins at T0 + 5 s.
  const restarted = (
    over: Partial<TrailServiceOptions> = {},
    rows: TrackHistoryPoint[] = [],
  ) => {
    const history = fakeHistory(rows);
    const base = 5_000;
    const made = setup(
      { history, startedAt: T0, backfillMs: 3_600_000, ...over },
      (trail) => {
        for (let s = 0; s <= 60; s++)
          trail.record(track(10_000 + s * 60, s, "a", base));
      },
    );
    return { ...made, history, firstT: T0 + base };
  };
  const earlier = Array.from({ length: 100 }, (_, i) => row(i * 60, -100 + i));

  it("is fetched by Mode-S address and joined to what memory has, in time order", async () => {
    const { service, history, firstT } = restarted({}, earlier);
    const a = await service.get("a", {});
    expect(a?.source).toBe("memory+database");
    expect(history.calls).toHaveLength(1);
    expect(history.calls[0]).toMatchObject({
      icao24: "8a0f21",
      fromMs: firstT - 3_600_000,
      toMs: firstT - 1,
    });
    expect(history.calls[0]).not.toHaveProperty("trackId");
    const ts = (a?.slice.points ?? []).map((p) => p.t);
    expect(ts).toEqual([...ts].sort((x, y) => x - y));
    expect(ts[0]).toBeLessThan(firstT); // starts before the restart
    expect(ts.at(-1)).toBeGreaterThan(firstT); // and runs on into memory
  });

  it("asks the database only once per track", async () => {
    const { service, history } = restarted({}, earlier);
    await service.get("a", {});
    await service.get("a", {});
    expect(history.calls).toHaveLength(1);
  });

  it("is off unless TRAIL_BACKFILL_MS is set", async () => {
    const { service, history } = restarted({ backfillMs: 0 }, earlier);
    const a = await service.get("a", {});
    expect(a?.source).toBe("memory");
    expect(history.calls).toEqual([]);
  });

  it("is not looked for when the trail began long after the process started (the flight began here)", async () => {
    const { service, history } = restarted(
      { startedAt: T0 - 3_600_000 },
      earlier,
    );
    expect((await service.get("a", {}))?.source).toBe("memory");
    expect(history.calls).toEqual([]);
  });

  it("is not looked for without a Mode-S address", async () => {
    const { service, history } = restarted(
      { icao24Of: () => undefined },
      earlier,
    );
    expect((await service.get("a", {}))?.source).toBe("memory");
    expect(history.calls).toEqual([]);
  });

  it("a request for a period before memory's start reaches for the database even without a restart", async () => {
    const history = fakeHistory(earlier);
    const { service } = setup(
      { history, startedAt: T0 - 7_200_000 },
      (trail) => {
        for (let s = 0; s <= 60; s++)
          trail.record(track(10_000 + s * 60, s, "a", 5_000));
      },
    );
    const a = await service.get("a", { fromMs: T0 - 100_000 });
    expect(a?.source).toBe("memory+database");
    expect(history.calls[0]).toMatchObject({
      icao24: "8a0f21",
      fromMs: T0 - 100_000,
    });
  });

  it("a request that starts inside memory's range does not need the database", async () => {
    const { service, history, firstT } = restarted({}, earlier);
    expect((await service.get("a", { fromMs: firstT + 10_000 }))?.source).toBe(
      "memory",
    );
    expect(history.calls).toEqual([]);
  });

  it("applies limit and stepM to the joined trail", async () => {
    const { service } = restarted({}, earlier);
    expect((await service.get("a", { limit: 15 }))?.slice.points).toHaveLength(
      15,
    );
  });

  it("memory still answers when the database fails or is too slow", async () => {
    const failing = fakeHistory(async () => {
      throw new Error("db down");
    });
    const a = await restarted({ history: failing }).service.get("a", {});
    expect(a?.source).toBe("memory");
    expect(a?.slice.points.length).toBeGreaterThan(5);

    const hung = fakeHistory(() => new Promise<TrackHistoryPoint[]>(() => {}));
    const started = Date.now();
    const b = await restarted({ history: hung, dbTimeoutMs: 30 }).service.get(
      "a",
      {},
    );
    expect(b?.source).toBe("memory");
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
