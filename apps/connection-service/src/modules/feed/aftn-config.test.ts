import { describe, expect, it } from "bun:test";
import { loadAftnFeedConfigs } from "./aftn-config";

describe("loadAftnFeedConfigs", () => {
  it("returns nothing when unconfigured", () => {
    expect(loadAftnFeedConfigs({})).toEqual({ feeds: [], warnings: [] });
  });

  it("builds a UDP feed with airport and multicast", () => {
    const { feeds } = loadAftnFeedConfigs({
      AFTN_FEED_UDP_PORT: "13218",
      AEROSWARM_AIRPORT_ID: "WARR",
      AFTN_FEED_MULTICAST_GROUP: "224.0.0.5",
      AFTN_FEED_MULTICAST_IFACE: "10.0.0.2",
    });
    expect(feeds).toHaveLength(1);
    expect(feeds[0]?.name).toBe("aftn-udp");
    expect(feeds[0]?.config).toMatchObject({
      transport: "udp",
      port: 13218,
      airportId: "WARR",
      sourceId: "aftn-udp",
      multicastGroup: "224.0.0.5",
      multicastIface: "10.0.0.2",
    });
  });

  it("builds a TCP client feed and needs host and port together", () => {
    const ok = loadAftnFeedConfigs({
      AFTN_TCP_HOST: "aftn.local",
      AFTN_TCP_PORT: "9000",
    });
    expect(ok.feeds[0]?.config).toMatchObject({
      transport: "tcp",
      host: "aftn.local",
      port: 9000,
      sourceId: "aftn-tcp",
    });
    for (const env of [
      { AFTN_TCP_HOST: "aftn.local" },
      { AFTN_TCP_PORT: "9000" },
    ]) {
      const r = loadAftnFeedConfigs(env);
      expect(r.feeds).toEqual([]);
      expect(
        r.warnings.some((w) => w.includes("AFTN_TCP_HOST and AFTN_TCP_PORT")),
      ).toBe(true);
    }
  });

  it("runs UDP and TCP side by side", () => {
    const { feeds } = loadAftnFeedConfigs({
      AFTN_FEED_UDP_PORT: "13218",
      AFTN_TCP_HOST: "aftn.local",
      AFTN_TCP_PORT: "9000",
    });
    expect(feeds.map((f) => f.name)).toEqual(["aftn-udp", "aftn-tcp"]);
  });

  it("rejects invalid ports with a warning", () => {
    for (const bad of ["abc", "0", "70000"]) {
      const r = loadAftnFeedConfigs({ AFTN_FEED_UDP_PORT: bad });
      expect(r.feeds).toEqual([]);
      expect(r.warnings.some((w) => w.includes("not a valid port"))).toBe(true);
    }
  });

  describe("AFTN_FEEDS", () => {
    const load = (feeds: unknown, extra: Record<string, string> = {}) =>
      loadAftnFeedConfigs({
        AEROSWARM_AIRPORT_ID: "WARR",
        ...extra,
        AFTN_FEEDS: JSON.stringify(feeds),
      });

    it("adds any number of feeds on top of the single-feed env", () => {
      const { feeds, warnings } = load(
        [
          { name: "a", transport: "udp", port: 13219 },
          { name: "b", transport: "tcp", host: "gw1", port: 9000 },
          {
            transport: "tcp",
            host: "gw2",
            port: 9001,
            airportId: "WIII",
            sourceId: "gw2-src",
          },
        ],
        { AFTN_FEED_UDP_PORT: "13218" },
      );
      expect(warnings).toEqual([]);
      expect(feeds.map((f) => f.name)).toEqual([
        "aftn-udp",
        "a",
        "b",
        "aftn-tcp-3",
      ]);
      expect(feeds[3]?.config).toMatchObject({
        airportId: "WIII",
        sourceId: "gw2-src",
      });
      expect(feeds[1]?.config.airportId).toBe("WARR");
    });

    it("skips bad entries and clashes with a warning", () => {
      const { feeds, warnings } = load([
        { name: "ok", transport: "udp", port: 13218 },
        { name: "ok", transport: "udp", port: 13219 },
        { name: "same-port", transport: "udp", port: 13218 },
        { name: "no-host", transport: "tcp", port: 9000 },
        { name: "bad", transport: "x", port: 1 },
        7,
      ]);
      expect(feeds.map((f) => f.name)).toEqual(["ok"]);
      expect(warnings.length).toBe(5);
    });

    it("ignores malformed JSON and non-arrays", () => {
      for (const raw of ["{nope", '{"a":1}']) {
        const r = loadAftnFeedConfigs({ AFTN_FEEDS: raw });
        expect(r.feeds).toEqual([]);
        expect(r.warnings.some((w) => w.startsWith("AFTN_FEEDS"))).toBe(true);
      }
    });
  });
});
