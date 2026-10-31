import { afterEach, describe, expect, it } from "bun:test";
import { createSocket } from "node:dgram";
import { createServer, type Server, type Socket } from "node:net";
import {
  getFeedStates,
  startAsterixFeeds,
  stopAsterixFeeds,
} from "./asterix-feed";

// Real captured CAT021 report (MAS179), also used by the @aeroswarm/ingest tests.
const CAT21 = Buffer.from(
  "15002fffa35b0220b100286cbde60009e2d0010f228475021b17f000070805a0000008e6c6733414f1df982000003e",
  "hex",
);

/** Synthetic CAT010 surface report: vehicle fleet 2 at Juanda. */
function cat10(lat: number, lon: number): Buffer {
  const scale = 180 / 2 ** 31;
  const pos = Buffer.alloc(8);
  pos.writeInt32BE(Math.round(lat / scale), 0);
  pos.writeInt32BE(Math.round(lon / scale), 4);
  const body = Buffer.concat([
    Buffer.from([0xc9, 0x05, 0x40]),
    Buffer.from([0x32, 0xb0]),
    Buffer.from([0x01]),
    pos,
    Buffer.from([0x8a, 0x01, 0xff]),
    Buffer.from([0x02]),
  ]);
  return Buffer.concat([Buffer.from([0x0a, 0x00, body.length + 3]), body]);
}

type Fused = {
  trackId: string;
  protocol: string;
  lifecycle: string;
  airportId?: string;
  identity: { icao24: string; callsign?: string; targetType?: string };
  position?: { lat: number; lon: number; onGround?: boolean };
};

async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 15));
  }
}

async function freeUdpPort(): Promise<number> {
  const s = createSocket("udp4");
  await new Promise<void>((r) => s.bind(0, "127.0.0.1", () => r()));
  const port = s.address().port;
  s.close();
  return port;
}

const baseEnv = {
  AEROSWARM_AIRPORT_ID: "WARR",
  ASTERIX_FORCED_EDITIONS: "21:0.26",
  RADAR_SITE_LAT: "-7.38",
  RADAR_SITE_LON: "112.78",
};

describe("asterix feeds against real sockets", () => {
  const servers: Server[] = [];
  const clients: Socket[] = [];
  afterEach(async () => {
    await stopAsterixFeeds();
    for (const c of clients.splice(0)) c.destroy();
    for (const s of servers.splice(0)) s.close();
  });

  const collect = () => {
    const events: Fused[] = [];
    return {
      events,
      persist: (e: unknown) => {
        events.push(e as Fused);
      },
    };
  };

  async function sendUdp(port: number, data: Buffer): Promise<void> {
    const s = createSocket("udp4");
    await new Promise<void>((r) => s.send(data, port, "127.0.0.1", () => r()));
    s.close();
  }

  it("decodes a UDP datagram into a stored fused track", async () => {
    const port = await freeUdpPort();
    const { events, persist } = collect();
    startAsterixFeeds({
      env: {
        ...baseEnv,
        AEROSWARM_FEED_UDP_PORT: String(port),
        AEROSWARM_FEED_UDP_HOST: "127.0.0.1",
      },
      persist,
    });
    await until(() => getFeedStates()[0]?.stats.running === true);

    await sendUdp(port, CAT21);
    await until(() => events.length > 0);

    const ev = events[0];
    expect(ev?.identity.icao24).toBe("75021b");
    expect(ev?.identity.callsign).toBe("MAS179");
    expect(ev?.protocol).toBe("asterix-cat021");
    expect(ev?.airportId).toBe("WARR");
    expect(ev?.position?.lat).toBeCloseTo(3.4755, 3);
    expect(ev?.position?.onGround).toBe(false);
  });

  it("marks CAT010 surface targets onGround and classifies the vehicle", async () => {
    const port = await freeUdpPort();
    const { events, persist } = collect();
    startAsterixFeeds({
      env: {
        ...baseEnv,
        AEROSWARM_FEED_UDP_PORT: String(port),
        AEROSWARM_FEED_UDP_HOST: "127.0.0.1",
      },
      persist,
    });
    await until(() => getFeedStates()[0]?.stats.running === true);

    await sendUdp(port, cat10(-7.3798, 112.7869));
    await until(() => events.length > 0);

    expect(events[0]?.position?.onGround).toBe(true);
    expect(events[0]?.identity.targetType).toBe("vehicle");
  });

  it("connects to a TCP radar, decodes a framed stream split mid-record, and reconnects", async () => {
    const received: Socket[] = [];
    const server = createServer((sock) => {
      received.push(sock);
      clients.push(sock);
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;

    const { events, persist } = collect();
    startAsterixFeeds({
      env: {
        ...baseEnv,
        ASTERIX_TCP_HOST: "127.0.0.1",
        ASTERIX_TCP_PORT: String(port),
      },
      persist,
    });
    await until(() => received.length === 1);

    // One record delivered in two TCP segments.
    const first = CAT21.subarray(0, 10);
    const rest = CAT21.subarray(10);
    received[0]?.write(first);
    await new Promise((r) => setTimeout(r, 60));
    expect(events).toHaveLength(0);
    received[0]?.write(rest);
    await until(() => events.length === 1);
    expect(events[0]?.identity.icao24).toBe("75021b");

    // Radar drops the connection; the feed dials back in (retry is 5 s).
    received[0]?.destroy();
    await until(() => received.length === 2, 9000);
    received[1]?.write(CAT21);
    await until(() => events.length === 2);
  }, 20000);

  it("runs a UDP and a TCP feed side by side from ASTERIX_FEEDS", async () => {
    const udpPort = await freeUdpPort();
    const tcpClients: Socket[] = [];
    const server = createServer((sock) => {
      tcpClients.push(sock);
      clients.push(sock);
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const tcpPort = (server.address() as { port: number }).port;

    const { events, persist } = collect();
    startAsterixFeeds({
      env: {
        ...baseEnv,
        ASTERIX_FEEDS: JSON.stringify([
          { name: "u", transport: "udp", port: udpPort, bindHost: "127.0.0.1" },
          { name: "t", transport: "tcp", host: "127.0.0.1", port: tcpPort },
        ]),
      },
      persist,
    });
    await until(() => tcpClients.length === 1);
    await until(() => getFeedStates().every((f) => f.stats.running === true));

    await sendUdp(udpPort, cat10(-7.3798, 112.7869));
    tcpClients[0]?.write(CAT21);
    await until(() => events.length === 2);

    expect(events.map((e) => e.protocol).sort()).toEqual([
      "asterix-cat010",
      "asterix-cat021",
    ]);
    expect(getFeedStates().map((f) => f.name)).toEqual(["u", "t"]);
  });

  it("emits dropped events for live tracks when stopped", async () => {
    const port = await freeUdpPort();
    const { events, persist } = collect();
    startAsterixFeeds({
      env: {
        ...baseEnv,
        AEROSWARM_FEED_UDP_PORT: String(port),
        AEROSWARM_FEED_UDP_HOST: "127.0.0.1",
      },
      persist,
    });
    await until(() => getFeedStates()[0]?.stats.running === true);
    await sendUdp(port, CAT21);
    await until(() => events.length === 1);

    await stopAsterixFeeds();
    expect(events.at(-1)?.lifecycle).toBe("dropped");
    expect(events.at(-1)?.trackId).toBe(events[0]?.trackId ?? "");
  });
});
