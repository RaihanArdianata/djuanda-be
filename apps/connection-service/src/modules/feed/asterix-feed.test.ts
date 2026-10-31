import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const enqueued: unknown[] = [];
const persist = (e: unknown) => {
  enqueued.push(e);
};

import {
  getFeedStates,
  startAsterixFeeds,
  stopAsterixFeeds,
} from "./asterix-feed";

/** First element, failing the test with a clear message instead of a non-null assertion. */
function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("expected at least one item");
  return item;
}

type Emit = (ev: unknown) => void;
type CreateSource = NonNullable<
  Parameters<typeof startAsterixFeeds>[0]["createSource"]
>;

function fakeFactory() {
  const sources: Array<{
    name: string;
    emit: Emit;
    stopped: boolean;
    stats: Record<string, unknown>;
  }> = [];
  const createSource = (feed: { name: string }) => {
    const rec = {
      name: feed.name,
      emit: (() => {}) as Emit,
      stopped: false,
      stats: { running: true, packetsReceived: 0 },
    };
    sources.push(rec);
    return {
      stats: rec.stats,
      start(onEvent: Emit) {
        rec.emit = onEvent;
      },
      async stop() {
        rec.stopped = true;
      },
    };
  };
  return {
    sources,
    createSource: createSource as unknown as NonNullable<
      Parameters<typeof startAsterixFeeds>[0]["createSource"]
    >,
  };
}

const track = (over: Record<string, unknown> = {}) => ({
  kind: "track",
  event: {
    trackId: "t1",
    identity: { icao24: "8a0f21" },
    lifecycle: "updated",
    fusedAt: 1,
    ...over,
  },
});

describe("startAsterixFeeds", () => {
  beforeEach(() => {
    enqueued.length = 0;
  });
  afterEach(async () => {
    await stopAsterixFeeds();
  });

  it("starts nothing without feed env", () => {
    const f = fakeFactory();
    startAsterixFeeds({ env: {}, createSource: f.createSource, persist });
    expect(f.sources).toHaveLength(0);
    expect(getFeedStates()).toEqual([]);
  });

  it("starts UDP and TCP together", () => {
    const f = fakeFactory();
    startAsterixFeeds({
      env: {
        AEROSWARM_FEED_UDP_PORT: "30000",
        ASTERIX_TCP_HOST: "radar",
        ASTERIX_TCP_PORT: "2000",
      },
      createSource: f.createSource,
      persist,
    });
    expect(f.sources.map((s) => s.name)).toEqual([
      "asterix-udp",
      "asterix-tcp",
    ]);
    expect(getFeedStates().map((s) => s.name)).toEqual([
      "asterix-udp",
      "asterix-tcp",
    ]);
  });

  it("starts every feed in ASTERIX_FEEDS and keeps their events apart", () => {
    const f = fakeFactory();
    const seen: string[] = [];
    startAsterixFeeds({
      env: {
        ASTERIX_FEEDS: JSON.stringify([
          { name: "a", transport: "udp", port: 30000 },
          { name: "b", transport: "udp", port: 30001 },
          { name: "c", transport: "tcp", host: "radar", port: 2000 },
        ]),
      },
      createSource: f.createSource,
      persist,
      handlers: { onTrack: (e) => seen.push(e.trackId) },
    });
    expect(f.sources.map((x) => x.name)).toEqual(["a", "b", "c"]);
    f.sources[0]?.emit(track({ trackId: "from-a" }));
    f.sources[2]?.emit(track({ trackId: "from-c" }));
    expect(seen).toEqual(["from-a", "from-c"]);
    expect(getFeedStates().map((x) => x.name)).toEqual(["a", "b", "c"]);
  });

  it("is idempotent while running", () => {
    const f = fakeFactory();
    const opts = {
      env: { AEROSWARM_FEED_UDP_PORT: "30000" },
      createSource: f.createSource,
      persist,
    };
    startAsterixFeeds(opts);
    startAsterixFeeds(opts);
    expect(f.sources).toHaveLength(1);
  });

  it("persists every fused track, including dropped, and calls onTrack after", () => {
    const f = fakeFactory();
    const order: string[] = [];
    startAsterixFeeds({
      env: { AEROSWARM_FEED_UDP_PORT: "30000" },
      createSource: f.createSource,
      persist: () => order.push("persist"),
      handlers: { onTrack: () => order.push("onTrack") },
    });
    first(f.sources).emit(track());
    first(f.sources).emit(track({ lifecycle: "dropped" }));
    expect(order).toEqual(["persist", "onTrack", "persist", "onTrack"]);
  });

  it("hands the fused event to persist unchanged", () => {
    const f = fakeFactory();
    startAsterixFeeds({
      env: { AEROSWARM_FEED_UDP_PORT: "30000" },
      createSource: f.createSource,
      persist,
    });
    first(f.sources).emit(track());
    expect(enqueued).toHaveLength(1);
    expect((enqueued[0] as { trackId: string }).trackId).toBe("t1");
  });

  it("ignores CurrentTrack-shaped events, raw dumps and status notices", () => {
    const f = fakeFactory();
    startAsterixFeeds({
      env: { AEROSWARM_FEED_UDP_PORT: "30000" },
      createSource: f.createSource,
      persist: () => {
        throw new Error("must not persist");
      },
    });
    const emit = first(f.sources).emit;
    emit({
      kind: "track",
      event: { trackId: "x", icao24: "a", lat: 1, lon: 2 },
    });
    emit({ kind: "raw", topic: "t", key: "k", fields: {} });
    emit({ kind: "status", status: "up" });
  });

  it("a throwing persist or handler never stops the feed", () => {
    const f = fakeFactory();
    let seen = 0;
    startAsterixFeeds({
      env: { AEROSWARM_FEED_UDP_PORT: "30000" },
      createSource: f.createSource,
      persist: () => {
        throw new Error("db down");
      },
      handlers: {
        onTrack: () => {
          seen++;
          throw new Error("consumer bug");
        },
      },
    });
    first(f.sources).emit(track());
    first(f.sources).emit(track());
    expect(seen).toBe(2);
  });

  it("tracks ground-station health and forwards it", () => {
    const f = fakeFactory();
    const seen: string[] = [];
    startAsterixFeeds({
      env: { AEROSWARM_FEED_UDP_PORT: "30000" },
      createSource: f.createSource,
      persist,
      handlers: { onHealth: (e) => seen.push(e.status) },
    });
    const health = (status: string) => ({
      kind: "health",
      event: { sourceId: "s", status },
    });
    first(f.sources).emit(health("healthy"));
    first(f.sources).emit(health("degraded"));
    expect(seen).toEqual(["healthy", "degraded"]);
    expect(first(getFeedStates()).lastHealth).toBe("degraded");
  });

  it("forwards AFTN found on the ASTERIX stream", () => {
    const f = fakeFactory();
    const seen: unknown[] = [];
    startAsterixFeeds({
      env: { AEROSWARM_FEED_UDP_PORT: "30000" },
      createSource: f.createSource,
      persist,
      handlers: { onFlightPlan: (e) => seen.push(e) },
    });
    first(f.sources).emit({ kind: "flightplan", event: { messageId: "m1" } });
    expect(seen).toEqual([{ messageId: "m1" }]);
  });

  it("stops every source and allows a restart", async () => {
    const f = fakeFactory();
    const opts = {
      env: { AEROSWARM_FEED_UDP_PORT: "30000" },
      createSource: f.createSource,
      persist,
    };
    startAsterixFeeds(opts);
    await stopAsterixFeeds();
    expect(first(f.sources).stopped).toBe(true);
    expect(getFeedStates()).toEqual([]);
    startAsterixFeeds(opts);
    expect(f.sources).toHaveLength(2);
  });

  it("survives a source whose start() throws", () => {
    const f = fakeFactory();
    startAsterixFeeds({
      env: {
        AEROSWARM_FEED_UDP_PORT: "30000",
        ASTERIX_TCP_HOST: "radar",
        ASTERIX_TCP_PORT: "2000",
      },
      persist,
      createSource: ((feed: Parameters<CreateSource>[0]) => {
        if (feed.name === "asterix-udp") {
          return {
            stats: {},
            start() {
              throw new Error("EADDRINUSE");
            },
            async stop() {},
          };
        }
        return f.createSource(feed);
      }) as unknown as NonNullable<
        Parameters<typeof startAsterixFeeds>[0]["createSource"]
      >,
    });
    expect(f.sources.map((s) => s.name)).toEqual(["asterix-tcp"]);
  });
});
