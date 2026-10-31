import { afterEach, describe, expect, it } from "bun:test";
import type { FlightPlanEvent, FusedTrackEvent } from "@aeroswarm/core";
import { streamEnvelopeSchema } from "@aeroswarm/core/validation";
import { createTokenVerifier } from "../auth/token";
import { liveConfigFromEnv } from "./live-config";
import { createLiveRuntime, type LiveRuntime } from "./live-runtime";
import {
  LIVE_WS_PATH,
  type LiveSocketData,
  liveSocketHandlers,
  upgradeLive,
} from "./live-socket";

const verifier = createTokenVerifier({
  tokens: ["secret-token-123456"],
  airportId: "WARR",
});

const fused = (over: Partial<FusedTrackEvent> = {}): FusedTrackEvent => ({
  trackId: "t1",
  sources: ["asterix-udp"],
  airportId: "WARR",
  identity: { icao24: "8a0f21", callsign: "GIA123" },
  protocol: "asterix-cat021",
  position: { lat: -7.38, lon: 112.78, alt: 0, onGround: true },
  velocity: { groundSpeed: 10, heading: 90 },
  confidence: {
    overall: 0.9,
    position: 0.9,
    identity: 0.9,
    velocity: 0.9,
    sourceAgreement: 1,
    spoofRisk: 0,
  },
  fusedAt: Date.now(),
  updatedAt: Date.now(),
  lifecycle: "updated",
  ...over,
});

const fpl = (over: Record<string, unknown> = {}): FlightPlanEvent => ({
  messageId: "m1",
  sourceId: "aftn",
  airportId: "WARR",
  receivedAt: Date.now(),
  message: {
    type: "FPL",
    header: { addressees: ["WARRYFYX"] },
    text: "",
    callsign: "GIA123",
    adep: "WARR",
    ades: "WIII",
    status: "filed",
    phase: "UNKNOWN",
    other: {},
    ...over,
  } as unknown as FlightPlanEvent["message"],
});

type Env = { type: string; seq: number; payload: Record<string, unknown> };

interface Client {
  ws: WebSocket;
  messages: Env[];
  closed: Promise<number>;
  of(type: string): Env[];
}

function open(url: string): Client {
  const ws = new WebSocket(url);
  const messages: Env[] = [];
  ws.onmessage = (e) => {
    messages.push(JSON.parse(String(e.data)) as Env);
  };
  const closed = new Promise<number>((resolve) => {
    ws.onclose = (e) => resolve(e.code);
  });
  return {
    ws,
    messages,
    closed,
    of: (t) => messages.filter((m) => m.type === t),
  };
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("live WebSocket (real Bun server + WebSocket client)", () => {
  let runtime: LiveRuntime | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;
  const clients: Client[] = [];

  afterEach(() => {
    for (const c of clients.splice(0)) c.ws.close();
    server?.stop(true);
    runtime?.stop();
    server = null;
    runtime = null;
  });

  function start(env: Record<string, string> = {}): string {
    runtime = createLiveRuntime({
      authenticate: (t) => verifier.verify(t),
      config: liveConfigFromEnv({ WS_DEFAULT_UPDATE_HZ: "60", ...env }),
    });
    const handlers = liveSocketHandlers(runtime.live);
    server = Bun.serve<LiveSocketData>({
      port: 0,
      fetch(req, srv) {
        const r = upgradeLive(req, srv);
        return r === null ? new Response("not found", { status: 404 }) : r;
      },
      websocket: handlers,
    });
    return `ws://127.0.0.1:${server.port}${LIVE_WS_PATH}`;
  }

  const connect = (url: string): Client => {
    const c = open(url);
    clients.push(c);
    return c;
  };
  const tracksOf = (m: Env | undefined): unknown[] =>
    (m?.payload.tracks as unknown[] | undefined) ?? [];
  const trackOf = (
    m: Env | undefined,
  ): { status?: string; flightPlan?: { phase: string } } =>
    (m?.payload.track as
      | { status?: string; flightPlan?: { phase: string } }
      | undefined) ?? {};
  const subscribe = (c: Client, extra: Record<string, unknown> = {}): void => {
    c.ws.send(JSON.stringify({ type: "subscribe", ...extra }));
  };

  it("rejects a missing token with 4001 and a wrong token with 4003", async () => {
    const url = start();
    expect(await connect(url).closed).toBe(4001);
    expect(await connect(`${url}?token=nope`).closed).toBe(4003);
  });

  it("serves a snapshot, then deltas, all valid for @aeroswarm/client", async () => {
    const url = start();
    runtime?.feedHandlers.onTrack?.(fused());

    const c = connect(`${url}?token=secret-token-123456`);
    await until(() => c.of("stream.heartbeat").length > 0);
    subscribe(c);
    await until(() => c.of("snapshot").length === 1);
    expect(tracksOf(c.of("snapshot")[0]).length).toBe(1);

    runtime?.feedHandlers.onTrack?.(
      fused({
        trackId: "t2",
        identity: { icao24: "ff0001", callsign: "LNI77" },
      }),
    );
    await until(() => c.of("track.updated").length === 1);

    runtime?.feedHandlers.onTrack?.(
      fused({ trackId: "t2", lifecycle: "dropped" }),
    );
    await until(() => c.of("track.removed").length === 1);
    expect(c.of("track.removed")[0]?.payload).toEqual({
      trackId: "t2",
      reason: "dropped",
    });

    for (const m of c.messages) {
      expect(streamEnvelopeSchema.safeParse(m).success).toBe(true);
    }
    const seqs = c.messages.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("attaches the flight plan phase that drives the label colour", async () => {
    const url = start();
    const c = connect(`${url}?token=secret-token-123456`);
    await until(() => c.of("stream.heartbeat").length > 0);
    subscribe(c);
    await until(() => c.of("snapshot").length === 1);

    runtime?.feedHandlers.onTrack?.(fused());
    await until(() => c.of("track.updated").length === 1);
    const first = c.of("track.updated")[0]?.payload.track as {
      flightPlan?: unknown;
    };
    expect(first.flightPlan).toBeUndefined();

    // The plan arrives after the track is already on screen.
    runtime?.feedHandlers.onFlightPlan?.(fpl());
    await until(() => c.of("track.updated").length === 2);
    const second = c.of("track.updated")[1]?.payload.track as {
      flightPlan?: { phase: string };
    };
    expect(second.flightPlan?.phase).toBe("DEPARTURE");

    runtime?.feedHandlers.onTrack?.(
      fused({
        trackId: "t3",
        identity: { icao24: "aa0002", callsign: "LNI77" },
      }),
    );
    runtime?.feedHandlers.onFlightPlan?.(
      fpl({ callsign: "LNI77", adep: "WIII", ades: "WARR" }),
    );
    await until(() =>
      c
        .of("track.updated")
        .some(
          (m) =>
            (m.payload.track as { flightPlan?: { phase: string } }).flightPlan
              ?.phase === "ARRIVAL",
        ),
    );
  });

  it("turns a silent track stale then lost, and a delta never resets that colour source", async () => {
    const url = start({ STALE_AFTER_MS: "1000", LOST_AFTER_MS: "5000" });
    const c = connect(`${url}?token=secret-token-123456`);
    await until(() => c.of("stream.heartbeat").length > 0);
    subscribe(c);
    await until(() => c.of("snapshot").length === 1);

    runtime?.feedHandlers.onTrack?.(fused({ updatedAt: Date.now() }));
    await until(() => c.of("track.updated").length === 1);

    runtime?.state.sweep(Date.now() + 2000);
    await until(() => c.of("track.updated").length === 2);
    expect(trackOf(c.of("track.updated")[1]).status).toBe("stale");

    runtime?.state.sweep(Date.now() + 10000);
    await until(() => c.of("track.updated").length === 3);
    expect(trackOf(c.of("track.updated")[2]).status).toBe("lost");
  });

  it("a reconnecting client gets the current picture again", async () => {
    const url = start();
    runtime?.feedHandlers.onTrack?.(fused());
    const a = connect(`${url}?token=secret-token-123456`);
    await until(() => a.of("stream.heartbeat").length > 0);
    subscribe(a);
    await until(() => a.of("snapshot").length === 1);
    a.ws.close();
    await a.closed;

    const b = connect(`${url}?token=secret-token-123456`);
    await until(() => b.of("stream.heartbeat").length > 0);
    subscribe(b);
    await until(() => b.of("snapshot").length === 1);
    expect(tracksOf(b.of("snapshot")[0]).length).toBe(1);
  });

  it("keeps serving other clients when one disconnects abruptly", async () => {
    const url = start();
    const a = connect(`${url}?token=secret-token-123456`);
    const b = connect(`${url}?token=secret-token-123456`);
    await until(
      () =>
        a.of("stream.heartbeat").length > 0 &&
        b.of("stream.heartbeat").length > 0,
    );
    subscribe(a);
    subscribe(b);
    await until(
      () => a.of("snapshot").length === 1 && b.of("snapshot").length === 1,
    );
    a.ws.close();
    await a.closed;

    runtime?.feedHandlers.onTrack?.(fused());
    await until(() => b.of("track.updated").length === 1);
    expect(runtime?.live.stats().clients).toBe(1);
  });

  it("closes every client when the runtime stops", async () => {
    const url = start();
    const c = connect(`${url}?token=secret-token-123456`);
    await until(() => c.of("stream.heartbeat").length > 0);
    runtime?.stop();
    // The server sends 1001 (going away); Bun surfaces it to its own client as 1000.
    expect([1000, 1001]).toContain(await c.closed);
    expect(runtime?.live.stats().clients).toBe(0);
  });
});

describe("upgradeLive", () => {
  const srv = (ok: boolean): { upgrade: () => boolean } => ({
    upgrade: () => ok,
  });

  it("ignores other paths so routing can carry on", () => {
    for (const path of ["/aero/replay", "/health", "/ws/tracks/other"]) {
      expect(upgradeLive(new Request(`http://x${path}`), srv(true))).toBeNull();
    }
  });

  it("returns undefined on a successful upgrade and 400 on a failed one", async () => {
    expect(
      upgradeLive(new Request(`http://x${LIVE_WS_PATH}`), srv(true)),
    ).toBeUndefined();
    const failed = upgradeLive(
      new Request(`http://x${LIVE_WS_PATH}`),
      srv(false),
    );
    expect((failed as Response).status).toBe(400);
  });

  it("passes the token query parameter through", () => {
    let seen: LiveSocketData | undefined;
    upgradeLive(new Request(`http://x${LIVE_WS_PATH}?token=abc`), {
      upgrade: (_req, o) => {
        seen = o.data;
        return true;
      },
    });
    expect(seen).toEqual({ kind: "live", token: "abc" });
  });
});
