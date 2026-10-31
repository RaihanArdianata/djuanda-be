/**
 * Compares two live track streams (`/ws/tracks/live`) side by side, e.g.
 * AeroSwarm (A) against the new connection-service (B), for the parallel run
 * in docs/task/2026-10-31/11_validasi_dan_rollout.md.
 *
 *   bun scripts/compare-live.ts \
 *     --a wss://asmgcs.midigi.id/aeroswarm --a-token srctk_... \
 *     --b wss://asmgcs.midigi.id           --b-token <CONNECTION_API_TOKENS entry> \
 *     --airport WARR --duration 3600 --interval 5
 *
 * Exit code 0 when every threshold holds, 1 otherwise, 2 on bad arguments.
 * Both endpoints are the base URL; `/ws/tracks/live` is appended.
 */
import {
  Accumulator,
  DEFAULT_THRESHOLDS,
  diffMaps,
  formatReport,
  keyOf,
  type LiveTrack,
  type TrackMap,
  verdict,
} from "./lib/compare-live";

interface Args {
  a: string;
  aToken: string;
  b: string;
  bToken: string;
  airport?: string;
  durationS: number;
  intervalS: number;
}

function parseArgs(argv: string[]): Args | string {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const a = get("a");
  const b = get("b");
  const aToken = get("a-token") ?? process.env.COMPARE_A_TOKEN;
  const bToken = get("b-token") ?? process.env.COMPARE_B_TOKEN;
  if (!a || !b || !aToken || !bToken) {
    return "usage: bun scripts/compare-live.ts --a <url> --a-token <t> --b <url> --b-token <t> [--airport WARR] [--duration 600] [--interval 5]  (tokens may also come from COMPARE_A_TOKEN / COMPARE_B_TOKEN)";
  }
  return {
    a,
    b,
    aToken,
    bToken,
    airport: get("airport"),
    durationS: Number(get("duration") ?? 600),
    intervalS: Number(get("interval") ?? 5),
  };
}

/** Writes one line; a CLI report, so not the logger. */
function out(stream: NodeJS.WriteStream, text: string): void {
  stream.write(`${text}
`);
}

function wsUrl(base: string, token: string): string {
  const root = base.replace(/\/$/, "").replace(/^http/, "ws");
  return `${root}/ws/tracks/live?token=${encodeURIComponent(token)}`;
}

/** Keeps `map` equal to the server's picture; resolves when the socket closes. */
function follow(
  label: string,
  url: string,
  airport: string | undefined,
  map: TrackMap,
): { stop(): void } {
  const byId = new Map<string, string>();
  let closed = false;
  const ws = new WebSocket(url);
  ws.onopen = (): void => {
    ws.send(
      JSON.stringify({
        type: "subscribe",
        ...(airport && { airportId: airport }),
      }),
    );
  };
  ws.onmessage = (e: MessageEvent): void => {
    const m = JSON.parse(String(e.data)) as {
      type: string;
      payload: { tracks?: LiveTrack[]; track?: LiveTrack; trackId?: string };
    };
    if (m.type === "snapshot") {
      map.clear();
      byId.clear();
      for (const t of m.payload.tracks ?? []) put(map, byId, t);
    } else if (m.type === "track.updated" && m.payload.track) {
      put(map, byId, m.payload.track);
    } else if (m.type === "track.removed" && m.payload.trackId) {
      const key = byId.get(m.payload.trackId);
      if (key) map.delete(key);
      byId.delete(m.payload.trackId);
    }
  };
  ws.onclose = (e: CloseEvent): void => {
    if (!closed)
      out(
        process.stderr,
        `[${label}] connection closed (${e.code}) — samples continue with the last known picture`,
      );
  };
  return {
    stop(): void {
      closed = true;
      ws.close();
    },
  };
}

function put(map: TrackMap, byId: Map<string, string>, t: LiveTrack): void {
  const key = keyOf(t);
  map.set(key, t);
  byId.set(t.trackId, key);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    out(process.stderr, args);
    return 2;
  }
  const a: TrackMap = new Map();
  const b: TrackMap = new Map();
  const fa = follow("A", wsUrl(args.a, args.aToken), args.airport, a);
  const fb = follow("B", wsUrl(args.b, args.bToken), args.airport, b);

  const acc = new Accumulator();
  const started = Date.now();
  // Let both snapshots arrive before the first sample.
  await new Promise((r) => setTimeout(r, 3000));
  while (Date.now() - started < args.durationS * 1000) {
    acc.add(diffMaps(a, b));
    await new Promise((r) => setTimeout(r, args.intervalS * 1000));
  }
  fa.stop();
  fb.stop();

  const report = acc.report();
  out(process.stdout, formatReport(report));
  const v = verdict(report, DEFAULT_THRESHOLDS);
  if (v.ok) {
    out(process.stdout, "\nRESULT: OK");
    return 0;
  }
  out(process.stdout, `\nRESULT: FAIL\n- ${v.failures.join("\n- ")}`);
  return 1;
}

process.exit(await main());
