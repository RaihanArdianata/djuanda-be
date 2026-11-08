import { fail, ok, toResponse } from "@aeroswarm/core/api";
import { Hono } from "hono";
import { type TraceStore, verdict } from "./trace-store";

export interface TraceRouteDeps {
  store: TraceStore;
  /** True when the token may read traces. */
  authenticate: (token: string | null) => boolean;
}

/** Dibangun di index.ts, setelah gambaran udara ada. */
let deps: TraceRouteDeps | null = null;

export function registerTraceRoute(next: TraceRouteDeps | null): void {
  deps = next;
}

const bearer = (header: string | undefined): string | null =>
  header?.startsWith("Bearer ") ? header.slice(7) : null;

/** Jawaban langsung tidak boleh disajikan dari cache. */
function noStore(res: Response): Response {
  res.headers.set("cache-control", "no-store");
  return res;
}

/**
 * `GET /aero/trace?q=GIA322`: di tahap mana pesawat itu terakhir terlihat atau dibuang. `q` = callsign (sebagian pun boleh), ICAO24, atau
 * trackId. Setiap pesawat yang cocok dijawab dengan `verdict` (kesimpulan satu kalimat) dan `entries` (peralihan tiap tahap: ingest, fusi,
 * gambaran udara, dengan sensor, posisi, dan hitungannya).
 */
const app = new Hono().get("/trace", (c) => {
  if (!deps)
    return noStore(toResponse(fail("UNAVAILABLE", "trace is not enabled")));
  if (
    !deps.authenticate(
      bearer(c.req.header("authorization")) ?? c.req.query("token") ?? null,
    )
  ) {
    return noStore(toResponse(fail("UNAUTHORIZED", "Unauthorized")));
  }
  const q = c.req.query("q")?.trim() ?? "";
  if (q.length < 2)
    return noStore(
      toResponse(
        fail(
          "BAD_REQUEST",
          "q must be a callsign, an ICAO24 or a track id (at least 2 characters)",
        ),
      ),
    );

  const now = Date.now();
  const matches = deps.store.query(q).slice(0, 20);
  return noStore(
    toResponse(
      ok(
        {
          query: q,
          now,
          // Kosong berarti pesawat itu tidak pernah sampai ke layanan ini sejak ia mulai: feed tidak membawanya, atau sudah dibuang sebelum
          // ingest mencatat identitasnya.
          matches: matches.map((a) => ({
            icao24: a.icao24 ?? null,
            callsign: a.callsign ?? null,
            trackId: a.trackId ?? null,
            verdict: verdict(a, now),
            entries: a.entries.map((e) => ({
              stage: e.stage,
              outcome: e.outcome,
              detail: e.detail ?? null,
              sensor: e.sensor ?? null,
              count: e.count,
              firstAgoS: Math.round((now - e.firstAt) / 1000),
              lastAgoS: Math.round((now - e.lastAt) / 1000),
              lat: e.lat ?? null,
              lon: e.lon ?? null,
              alt: e.alt ?? null,
              onGround: e.onGround ?? null,
            })),
          })),
        },
        { count: matches.length },
      ),
    ),
  );
});

export default app;
