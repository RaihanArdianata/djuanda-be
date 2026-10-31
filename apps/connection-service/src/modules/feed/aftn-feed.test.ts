import { afterEach, describe, expect, it } from "bun:test";
import type { FlightPlanEvent } from "@aeroswarm/core";
import { getAftnFeedStates, startAftnFeeds, stopAftnFeeds } from "./aftn-feed";

type Emit = (ev: unknown) => void;
type CreateSource = NonNullable<
  Parameters<typeof startAftnFeeds>[0]["createSource"]
>;

const event = (id: string): FlightPlanEvent =>
  ({
    messageId: id,
    sourceId: "s",
    receivedAt: 1,
    message: { type: "FPL" },
  }) as FlightPlanEvent;

function fakeFactory() {
  const sources: Array<{ name: string; emit: Emit; stopped: boolean }> = [];
  const createSource = ((feed: { name: string }) => {
    const rec = { name: feed.name, emit: (() => {}) as Emit, stopped: false };
    sources.push(rec);
    return {
      stats: { running: true },
      start(onEvent: Emit) {
        rec.emit = onEvent;
      },
      async stop() {
        rec.stopped = true;
      },
    };
  }) as unknown as CreateSource;
  return { sources, createSource };
}

describe("startAftnFeeds", () => {
  afterEach(async () => {
    await stopAftnFeeds();
  });

  it("starts nothing without AFTN env", () => {
    const f = fakeFactory();
    startAftnFeeds({
      env: {},
      createSource: f.createSource,
      onFlightPlan: () => {},
    });
    expect(f.sources).toHaveLength(0);
    expect(getAftnFeedStates()).toEqual([]);
  });

  it("delivers flight plan events and publishes them after", () => {
    const f = fakeFactory();
    const order: string[] = [];
    startAftnFeeds({
      env: { AFTN_FEED_UDP_PORT: "13218" },
      createSource: f.createSource,
      onFlightPlan: (e) => order.push(`plan:${e.messageId}`),
      publish: (e) => {
        order.push(`pub:${e.messageId}`);
      },
    });
    f.sources[0]?.emit({ kind: "flightplan", event: event("m1") });
    f.sources[0]?.emit({ kind: "track", event: {} });
    f.sources[0]?.emit({ kind: "health", event: {} });
    expect(order).toEqual(["plan:m1", "pub:m1"]);
  });

  it("a throwing handler or a rejecting publish never stops the feed", async () => {
    const f = fakeFactory();
    let seen = 0;
    startAftnFeeds({
      env: { AFTN_FEED_UDP_PORT: "13218" },
      createSource: f.createSource,
      onFlightPlan: () => {
        seen++;
        throw new Error("consumer bug");
      },
      publish: () => Promise.reject(new Error("kafka down")),
    });
    f.sources[0]?.emit({ kind: "flightplan", event: event("m1") });
    f.sources[0]?.emit({ kind: "flightplan", event: event("m2") });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toBe(2);
  });

  it("runs several feeds and keeps going if one fails to start", () => {
    const f = fakeFactory();
    startAftnFeeds({
      env: {
        AFTN_FEEDS: JSON.stringify([
          { name: "a", transport: "udp", port: 13218 },
          { name: "b", transport: "tcp", host: "gw", port: 9000 },
        ]),
      },
      createSource: ((feed: { name: string }) => {
        if (feed.name === "a") {
          return {
            stats: {},
            start() {
              throw new Error("EADDRINUSE");
            },
            async stop() {},
          };
        }
        return (f.createSource as unknown as (x: unknown) => unknown)(feed);
      }) as unknown as CreateSource,
      onFlightPlan: () => {},
    });
    expect(f.sources.map((s) => s.name)).toEqual(["b"]);
    expect(getAftnFeedStates().map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("is idempotent while running, and restartable after stop", async () => {
    const f = fakeFactory();
    const opts = {
      env: { AFTN_FEED_UDP_PORT: "13218" },
      createSource: f.createSource,
      onFlightPlan: () => {},
    };
    startAftnFeeds(opts);
    startAftnFeeds(opts);
    expect(f.sources).toHaveLength(1);
    await stopAftnFeeds();
    expect(f.sources[0]?.stopped).toBe(true);
    startAftnFeeds(opts);
    expect(f.sources).toHaveLength(2);
  });
});
