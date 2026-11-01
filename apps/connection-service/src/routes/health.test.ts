import { afterEach, describe, expect, it } from "bun:test";
import type { IngestSourceStats } from "@aeroswarm/ingest";
import { Hono } from "hono";
import type { FeedState } from "../modules/feed/asterix-feed";

// health.ts only depends on Hono and types (no DB/Redis/Kafka), so it can be
// imported directly — it's mounted under /health the same way routes/index.ts
// does, to exercise the real public path.
const {
  default: health,
  buildHealth,
  registerHealthProbe,
} = await import("./health");
const app = new Hono().route("/health", health);

const feed = (over: Partial<IngestSourceStats> = {}): FeedState => ({
  name: "asterix-udp",
  lastHealth: null,
  stats: {
    running: true,
    transport: "udp",
    port: 2026,
    remote: null,
    packetsReceived: 100,
    packetsForwarded: 100,
    packetsRejected: 0,
    packetsSkipped: 0,
    packetsUndecoded: 0,
    lastError: null,
    ...over,
  },
});

const probe = (
  feeds: FeedState[],
  database: () => Promise<boolean> = async () => true,
): Parameters<typeof registerHealthProbe>[0] => ({
  feeds: () => feeds,
  live: () => ({ clients: 2, tracks: 7, flightplans: 3 }),
  database,
});

afterEach(() => registerHealthProbe(null));

describe("GET /health", () => {
  it("returns 200 with an ok status payload", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.process.status).toBe("healthy");
  });

  it("does not claim to know what it cannot see", async () => {
    const body = await (await app.request("/health")).json();
    expect(body.database.status).toBe("unknown");
    expect(body.decoder.status).toBe("unconfigured");
    expect(body.feeds).toEqual([]);
    expect(body.live).toBeNull();
  });

  it("reports the registered feeds, live picture and database", async () => {
    registerHealthProbe(probe([feed()]));
    const body = await (await app.request("/health")).json();
    expect(body.status).toBe("ok");
    expect(body.feeds[0]).toMatchObject({ name: "asterix-udp", port: 2026 });
    expect(body.decoder.status).toBe("ready");
    expect(body.database.status).toBe("up");
    expect(body.live).toEqual({ clients: 2, tracks: 7, flightplans: 3 });
  });
});

describe("buildHealth", () => {
  it("is degraded when the database is down or throws", async () => {
    expect((await buildHealth(probe([feed()], async () => false))).status).toBe(
      "degraded",
    );
    const boom = async (): Promise<boolean> => {
      throw new Error("down");
    };
    const r = await buildHealth(probe([feed()], boom));
    expect(r.status).toBe("degraded");
    expect(r.database.status).toBe("down");
  });

  it("is degraded when a feed is not running", async () => {
    const r = await buildHealth(probe([feed({ running: false })]));
    expect(r.status).toBe("degraded");
  });

  it("separates a silent radar from a broken decoder", async () => {
    const silent = await buildHealth(
      probe([feed({ packetsReceived: 0, packetsUndecoded: 0 })]),
    );
    expect(silent.decoder.status).toBe("no_data");
    expect(silent.status).toBe("ok");

    const broken = await buildHealth(
      probe([feed({ packetsReceived: 100, packetsUndecoded: 80 })]),
    );
    expect(broken.decoder.status).toBe("failing");
    expect(broken.status).toBe("degraded");
  });

  it("tolerates a few undecodable datagrams", async () => {
    const r = await buildHealth(
      probe([feed({ packetsReceived: 100, packetsUndecoded: 3 })]),
    );
    expect(r.decoder.status).toBe("ready");
  });
});
