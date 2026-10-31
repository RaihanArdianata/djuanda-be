import { describe, expect, it } from "bun:test";
import { loadAsterixFeedConfigs } from "./asterix-config";

/** First element, failing the test with a clear message instead of a non-null assertion. */
function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("expected at least one item");
  return item;
}

describe("loadAsterixFeedConfigs", () => {
  it("returns no feeds and no warnings noise when nothing is configured", () => {
    const { feeds, warnings } = loadAsterixFeedConfigs({});
    expect(feeds).toEqual([]);
    expect(warnings.some((w) => w.includes("TCP"))).toBe(false);
  });

  it("builds a UDP feed from the legacy env, keeping the old defaults", () => {
    const { feeds } = loadAsterixFeedConfigs({
      AEROSWARM_FEED_UDP_PORT: "30000",
      AEROSWARM_AIRPORT_ID: "WARR",
    });
    expect(feeds).toHaveLength(1);
    const f = first(feeds);
    expect(f.name).toBe("asterix-udp");
    expect(f.config).toMatchObject({
      transport: "udp",
      port: 30000,
      airportId: "WARR",
      sourceId: "asterix-udp",
    });
    expect([...(f.config.allowedCats ?? [])].sort((a, b) => a - b)).toEqual([
      10, 11, 20, 21, 48, 62,
    ]);
  });

  it("passes UDP bind host and multicast through", () => {
    const { feeds } = loadAsterixFeedConfigs({
      AEROSWARM_FEED_UDP_PORT: "30000",
      AEROSWARM_FEED_UDP_HOST: "10.0.0.2",
      AEROSWARM_FEED_MULTICAST_GROUP: "224.0.0.1",
      AEROSWARM_FEED_MULTICAST_IFACE: "10.0.0.2",
      AEROSWARM_FEED_SOURCE_ID: "radar-a",
    });
    expect(first(feeds).config).toMatchObject({
      bindHost: "10.0.0.2",
      multicastGroup: "224.0.0.1",
      multicastIface: "10.0.0.2",
      sourceId: "radar-a",
    });
  });

  it("builds a TCP client feed when host and port are both set", () => {
    const { feeds } = loadAsterixFeedConfigs({
      ASTERIX_TCP_HOST: "192.168.2.10",
      ASTERIX_TCP_PORT: "2000",
    });
    expect(feeds).toHaveLength(1);
    expect(first(feeds).name).toBe("asterix-tcp");
    expect(first(feeds).config).toMatchObject({
      transport: "tcp",
      host: "192.168.2.10",
      port: 2000,
      sourceId: "asterix-tcp",
    });
  });

  it("runs UDP and TCP side by side with distinct source ids", () => {
    const { feeds } = loadAsterixFeedConfigs({
      AEROSWARM_FEED_UDP_PORT: "30000",
      ASTERIX_TCP_HOST: "radar.local",
      ASTERIX_TCP_PORT: "2000",
    });
    expect(feeds.map((f) => f.name)).toEqual(["asterix-udp", "asterix-tcp"]);
    expect(new Set(feeds.map((f) => f.config.sourceId)).size).toBe(2);
  });

  it("warns and skips TCP when only one of host/port is set", () => {
    for (const env of [
      { ASTERIX_TCP_HOST: "radar.local" },
      { ASTERIX_TCP_PORT: "2000" },
    ]) {
      const { feeds, warnings } = loadAsterixFeedConfigs(env);
      expect(feeds).toEqual([]);
      expect(
        warnings.some((w) =>
          w.includes("ASTERIX_TCP_HOST and ASTERIX_TCP_PORT"),
        ),
      ).toBe(true);
    }
  });

  it("rejects invalid ports with a warning", () => {
    for (const bad of ["abc", "0", "70000", "30.5"]) {
      const { feeds, warnings } = loadAsterixFeedConfigs({
        AEROSWARM_FEED_UDP_PORT: bad,
      });
      expect(feeds).toEqual([]);
      expect(warnings.some((w) => w.includes("not a valid port"))).toBe(true);
    }
  });

  it("treats empty RADAR_SITE_* as unset, never as 0N 0E", () => {
    const { feeds, warnings } = loadAsterixFeedConfigs({
      AEROSWARM_FEED_UDP_PORT: "30000",
      RADAR_SITE_LAT: "",
      RADAR_SITE_LON: "",
    });
    expect(first(feeds).config.radarSite).toBeUndefined();
    expect(warnings.some((w) => w.includes("RADAR_SITE_LAT/LON"))).toBe(true);
  });

  it("reads the radar site and a per-sensor override map", () => {
    const { feeds, warnings } = loadAsterixFeedConfigs({
      AEROSWARM_FEED_UDP_PORT: "30000",
      RADAR_SITE_LAT: "-7.38",
      RADAR_SITE_LON: "112.78",
      ASTERIX_RADAR_SITES: JSON.stringify({
        "50:176": { lat: -7.4, lon: 112.8 },
        bad: { lat: 1, lon: 2 },
        "51:1": { lat: 999, lon: 0 },
      }),
    });
    expect(first(feeds).config.radarSite).toEqual({ lat: -7.38, lon: 112.78 });
    expect(first(feeds).config.radarSites).toEqual({
      "50:176": { lat: -7.4, lon: 112.8 },
    });
    expect(
      warnings.filter((w) => w.includes("ASTERIX_RADAR_SITES")),
    ).toHaveLength(2);
  });

  it("ignores malformed ASTERIX_RADAR_SITES", () => {
    const { feeds, warnings } = loadAsterixFeedConfigs({
      AEROSWARM_FEED_UDP_PORT: "30000",
      RADAR_SITE_LAT: "-7.38",
      RADAR_SITE_LON: "112.78",
      ASTERIX_RADAR_SITES: "{nope",
    });
    expect(first(feeds).config.radarSites).toBeUndefined();
    expect(warnings.some((w) => w.includes("not valid JSON"))).toBe(true);
  });

  it("parses allowed categories and forced editions", () => {
    const { feeds } = loadAsterixFeedConfigs({
      AEROSWARM_FEED_UDP_PORT: "30000",
      ASTERIX_ALLOWED_CATS: "21, 48,x,-1",
      ASTERIX_FORCED_EDITIONS: "21:2.4, 48:1.21, bad",
    });
    expect(
      [...(first(feeds).config.allowedCats ?? [])].sort((a, b) => a - b),
    ).toEqual([21, 48]);
    expect(first(feeds).config.forcedEditions).toEqual({
      21: "2.4",
      48: "1.21",
    });
  });

  describe("ASTERIX_FEEDS (several feeds)", () => {
    const base = {
      RADAR_SITE_LAT: "-7.38",
      RADAR_SITE_LON: "112.78",
      AEROSWARM_AIRPORT_ID: "WARR",
    };
    const load = (feeds: unknown, extra: Record<string, string> = {}) =>
      loadAsterixFeedConfigs({
        ...base,
        ...extra,
        ASTERIX_FEEDS: JSON.stringify(feeds),
      });

    it("runs several UDP and several TCP feeds", () => {
      const { feeds, warnings } = load([
        { name: "a", transport: "udp", port: 30000 },
        { name: "b", transport: "udp", port: 30001 },
        { name: "c", transport: "tcp", host: "10.0.0.5", port: 2000 },
        { name: "d", transport: "tcp", host: "10.0.0.6", port: 2000 },
      ]);
      expect(warnings.filter((w) => w.includes("ASTERIX_FEEDS"))).toEqual([]);
      expect(feeds.map((f) => f.name)).toEqual(["a", "b", "c", "d"]);
      expect(feeds.map((f) => f.config.transport)).toEqual([
        "udp",
        "udp",
        "tcp",
        "tcp",
      ]);
    });

    it("adds to the single-feed env instead of replacing it", () => {
      const { feeds } = load(
        [{ transport: "tcp", host: "radar", port: 2000 }],
        {
          AEROSWARM_FEED_UDP_PORT: "30000",
        },
      );
      expect(feeds.map((f) => f.name)).toEqual(["asterix-udp", "tcp-1"]);
    });

    it("inherits shared settings and lets each feed override them", () => {
      const { feeds } = load([
        { name: "a", transport: "udp", port: 30000 },
        {
          name: "b",
          transport: "udp",
          port: 30001,
          airportId: "WIII",
          allowedCats: [21, 48],
          forcedEditions: { "21": "2.4" },
          radarSite: { lat: -6, lon: 106 },
          sourceId: "radar-b",
        },
      ]);
      expect(feeds[0]?.config).toMatchObject({
        airportId: "WARR",
        radarSite: { lat: -7.38, lon: 112.78 },
        sourceId: "a",
      });
      expect(feeds[1]?.config).toMatchObject({
        airportId: "WIII",
        radarSite: { lat: -6, lon: 106 },
        forcedEditions: { 21: "2.4" },
        sourceId: "radar-b",
      });
      expect([...(feeds[1]?.config.allowedCats ?? [])]).toEqual([21, 48]);
    });

    it("passes bind host and multicast to UDP, and host to TCP only", () => {
      const { feeds } = load([
        {
          name: "a",
          transport: "udp",
          port: 30000,
          bindHost: "10.0.0.2",
          multicastGroup: "224.0.0.1",
          multicastIface: "10.0.0.2",
        },
        {
          name: "b",
          transport: "tcp",
          host: "radar",
          port: 2000,
          multicastGroup: "224.0.0.1",
        },
      ]);
      expect(feeds[0]?.config).toMatchObject({
        bindHost: "10.0.0.2",
        multicastGroup: "224.0.0.1",
        multicastIface: "10.0.0.2",
      });
      expect(feeds[1]?.config.host).toBe("radar");
      expect(feeds[1]?.config.multicastGroup).toBeUndefined();
    });

    it("names feeds by transport and position when no name is given", () => {
      const { feeds } = load([
        { transport: "udp", port: 30000 },
        { transport: "tcp", host: "radar", port: 2000 },
      ]);
      expect(feeds.map((f) => f.name)).toEqual(["udp-1", "tcp-2"]);
      expect(feeds.map((f) => f.config.sourceId)).toEqual(["udp-1", "tcp-2"]);
    });

    it("skips bad entries with a warning and keeps the good ones", () => {
      const { feeds, warnings } = load([
        { name: "ok", transport: "udp", port: 30000 },
        { name: "no-transport", port: 30001 },
        { name: "bad-port", transport: "udp", port: 70000 },
        { name: "string-port", transport: "udp", port: "30002" },
        { name: "no-host", transport: "tcp", port: 2000 },
        "nope",
      ]);
      expect(feeds.map((f) => f.name)).toEqual(["ok"]);
      expect(warnings.filter((w) => w.includes("ASTERIX_FEEDS")).length).toBe(
        5,
      );
    });

    it("rejects a duplicate name and a second UDP listener on the same port", () => {
      const { feeds, warnings } = load(
        [
          { name: "x", transport: "udp", port: 30000 },
          { name: "x", transport: "udp", port: 30001 },
          { name: "y", transport: "udp", port: 30000 },
          { name: "z", transport: "udp", port: 30000, bindHost: "10.0.0.2" },
        ],
        {},
      );
      expect(feeds.map((f) => f.name)).toEqual(["x", "z"]);
      expect(warnings.some((w) => w.includes("name already used"))).toBe(true);
      expect(
        warnings.some((w) => w.includes("UDP port 30000 is already used")),
      ).toBe(true);
    });

    it("also rejects a clash with the single-feed UDP env", () => {
      const { feeds, warnings } = load(
        [{ name: "dup", transport: "udp", port: 30000 }],
        {
          AEROSWARM_FEED_UDP_PORT: "30000",
        },
      );
      expect(feeds.map((f) => f.name)).toEqual(["asterix-udp"]);
      expect(warnings.some((w) => w.includes('used by "asterix-udp"'))).toBe(
        true,
      );
    });

    it("ignores ASTERIX_FEEDS that is not a JSON array", () => {
      for (const raw of ["{nope", '{"a":1}']) {
        const { feeds, warnings } = loadAsterixFeedConfigs({
          ...base,
          ASTERIX_FEEDS: raw,
        });
        expect(feeds).toEqual([]);
        expect(warnings.some((w) => w.startsWith("ASTERIX_FEEDS"))).toBe(true);
      }
    });
  });
});
