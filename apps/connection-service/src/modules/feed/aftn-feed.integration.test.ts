import { afterEach, describe, expect, it } from "bun:test";
import { createSocket } from "node:dgram";
import { createServer, type Server, type Socket } from "node:net";
import type { FlightPlanEvent, FusedTrackEvent } from "@aeroswarm/core";
import { createTokenVerifier } from "../auth/token";
import { createLiveRuntime, type LiveRuntime } from "../live/live-runtime";
import {
  LIVE_WS_PATH,
  type LiveSocketData,
  liveSocketHandlers,
  upgradeLive,
} from "../live/live-socket";
import { getAftnFeedStates, startAftnFeeds, stopAftnFeeds } from "./aftn-feed";

// Real-shaped FPL as received from the kantor AFTN gateway (also used by the
// @aeroswarm/ingest tests): BTK7630, WARR -> WIII.
const FPL = [
  "\x01NDP1955 160316 30",
  "FF WRRRYAYD WIIIYAYX",
  "160317 CYYZXNSX",
  "(FPL-BTK7630-IS",
  "-A320/M-SDFGHIR/EB1",
  "-WARR1710",
  "-N0450F350 DCT ABMAL L897 BIKMA DCT",
  "-WIII0120 WIDD",
  "-PBN/A1B1C1D1L1O1S2 NAV/RNP2 REG/PKBTK DOF/261016 CODE/8A0123 EET/WAAF0045 OPR/BATIK AIR RMK/TCAS EQUIPPED)",
  "NNNN\x03",
].join("\r\n");

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

async function sendUdp(port: number, data: string): Promise<void> {
  const s = createSocket("udp4");
  await new Promise<void>((r) =>
    s.send(Buffer.from(data, "latin1"), port, "127.0.0.1", () => r()),
  );
  s.close();
}

describe("AFTN feeds against real sockets", () => {
  const servers: Server[] = [];
  const sockets: Socket[] = [];
  let runtime: LiveRuntime | null = null;
  let httpServer: ReturnType<typeof Bun.serve> | null = null;

  afterEach(async () => {
    await stopAftnFeeds();
    for (const c of sockets.splice(0)) c.destroy();
    for (const s of servers.splice(0)) s.close();
    httpServer?.stop(true);
    runtime?.stop();
    httpServer = null;
    runtime = null;
  });

  it("decodes an FPL datagram into a flight plan event for the airport", async () => {
    const port = await freeUdpPort();
    const events: FlightPlanEvent[] = [];
    startAftnFeeds({
      env: { AFTN_FEED_UDP_PORT: String(port), AEROSWARM_AIRPORT_ID: "WARR" },
      onFlightPlan: (e) => events.push(e),
    });
    await until(() => getAftnFeedStates()[0]?.stats.running === true);

    await sendUdp(port, FPL);
    await until(() => events.length === 1);

    expect(events[0]?.airportId).toBe("WARR");
    expect(events[0]?.sourceId).toBe("aftn-udp");
    expect(events[0]?.message).toMatchObject({
      type: "FPL",
      callsign: "BTK7630",
      adep: "WARR",
      ades: "WIII",
    });
  });

  it("reads messages from a TCP gateway, including one split across segments", async () => {
    const conns: Socket[] = [];
    const server = createServer((sock) => {
      conns.push(sock);
      sockets.push(sock);
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;

    const events: FlightPlanEvent[] = [];
    startAftnFeeds({
      env: { AFTN_TCP_HOST: "127.0.0.1", AFTN_TCP_PORT: String(port) },
      onFlightPlan: (e) => events.push(e),
    });
    await until(() => conns.length === 1);

    const cut = Math.floor(FPL.length / 2);
    conns[0]?.write(Buffer.from(FPL.slice(0, cut), "latin1"));
    await new Promise((r) => setTimeout(r, 60));
    expect(events).toHaveLength(0);
    conns[0]?.write(Buffer.from(FPL.slice(cut), "latin1"));
    await until(() => events.length === 1);
    expect(events[0]?.message.callsign).toBe("BTK7630");
    expect(events[0]?.sourceId).toBe("aftn-tcp");
  });

  it("gives a live client the DEPARTURE phase that the label colour depends on", async () => {
    const verifier = createTokenVerifier({
      tokens: ["secret-token-123456"],
      airportId: "WARR",
    });
    runtime = createLiveRuntime({
      authenticate: (t) => verifier.verify(t),
      config: {
        sweepMs: 5000,
        warnings: [],
        defaultUpdateHz: 60,
      },
    });
    const handlers = liveSocketHandlers(runtime.live);
    httpServer = Bun.serve<LiveSocketData>({
      port: 0,
      fetch(req, srv) {
        const r = upgradeLive(req, srv);
        return r === null ? new Response("nf", { status: 404 }) : r;
      },
      websocket: handlers,
    });

    const messages: Array<{ type: string; payload: Record<string, unknown> }> =
      [];
    const ws = new WebSocket(
      `ws://127.0.0.1:${httpServer.port}${LIVE_WS_PATH}?token=secret-token-123456`,
    );
    ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
    await until(() => messages.some((m) => m.type === "stream.heartbeat"));
    ws.send(JSON.stringify({ type: "subscribe" }));
    await until(() => messages.some((m) => m.type === "snapshot"));

    // The aircraft is on the radar first...
    const now = Date.now();
    runtime.feedHandlers.onTrack?.({
      trackId: "t1",
      sources: ["asterix-udp"],
      airportId: "WARR",
      identity: { icao24: "8a0123", callsign: "BTK7630" },
      protocol: "asterix-cat021",
      position: { lat: -7.38, lon: 112.78, alt: 0, onGround: true },
      velocity: { groundSpeed: 5, heading: 90 },
      confidence: {
        overall: 0.9,
        position: 0.9,
        identity: 0.9,
        velocity: 0.9,
        sourceAgreement: 1,
        spoofRisk: 0,
      },
      fusedAt: now,
      updatedAt: now,
      lifecycle: "updated",
    } as FusedTrackEvent);
    await until(() => messages.some((m) => m.type === "track.updated"));

    // ...then the real AFTN datagram arrives over UDP.
    const port = await freeUdpPort();
    startAftnFeeds({
      env: { AFTN_FEED_UDP_PORT: String(port), AEROSWARM_AIRPORT_ID: "WARR" },
      onFlightPlan: (e) => runtime?.feedHandlers.onFlightPlan?.(e),
    });
    await until(() => getAftnFeedStates()[0]?.stats.running === true);
    await sendUdp(port, FPL);

    await until(() =>
      messages.some(
        (m) =>
          m.type === "track.updated" &&
          (m.payload.track as { flightPlan?: { phase: string } }).flightPlan
            ?.phase === "DEPARTURE",
      ),
    );
    ws.close();
  });
});
