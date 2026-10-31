import {
  createInMemoryCheckpointStore,
  createPostgresStore,
  createReplayServer,
} from "@aeroswarm/replay-server";
import { logger } from "@repo/logger";
import { verifyToken } from "../../auth/token";

// This deployment's own airport identity. One backend-djuanda instance
// serves exactly one airport by design (docs/development/federation/004-*.md
// in aeroswarm-project) — but the monitor-token allowlist used to be a flat
// list with zero airport binding, so ANY valid token (even one meant for a
// different airport's deployment, if ever misconfigured/reused) could read
// this store's full contents, and a token minted here could in principle be
// pointed at another deployment's DB and see everything in it. Binding
// every token to AIRPORT_ID and filtering every query by it (below) closes
// that gap as defense-in-depth even though today's topology is single-
// tenant — see aeroswarm-project/docs/audit/tasks/006-*.md.
const AIRPORT_ID: string = process.env.AEROSWARM_AIRPORT_ID || "";
if (!AIRPORT_ID) {
  logger.warn(
    "AEROSWARM_AIRPORT_ID is not set — monitor tokens will validate but /aero/* history/replay queries will be UNSCOPED (any valid token sees every row in this DB). Set it to this deployment's ICAO code (e.g. WARR).",
  );
}

// Tokens come from CONNECTION_API_TOKENS (and the legacy
// AEROSWARM_MONITOR_TOKENS) via the shared verifier in modules/auth, which also
// guards the live WebSocket. Kept as a named export for the replay upgrade in
// index.ts.
export function isValidMonitorToken(token: string | null): boolean {
  return verifyToken(token) !== null;
}

// dbudara's aeroswarm_tracks/aeroswarm_alerts live in the default (public)
// schema with the adapter's default table names — no extra config needed.
// filterAirportId restricts every query to AIRPORT_ID's own rows, so even a
// token that shouldn't exist here (see comment above) can't read another
// airport's data out of this table.
export const replayStore = createPostgresStore({
  url: process.env.DATABASE_URL || "",
  filterAirportId: AIRPORT_ID || undefined,
});

// In-memory checkpoints: session resume (?sessionId=) survives reconnects
// but not a process restart — acceptable, resume then just starts fresh.
export const replayCheckpoints = createInMemoryCheckpointStore();

export const replayServer = createReplayServer({
  store: replayStore,
  checkpoints: replayCheckpoints,
  validateToken: async (token: string) => {
    const auth = verifyToken(token);
    return auth
      ? { airportId: auth.airportId ?? (AIRPORT_ID || undefined) }
      : null;
  },
});

// Per-connection envelope sequence numbers (see ReplaySession) — one shared
// monotonic counter, same as AeroSwarm's own WS layer.
let seq = 0;
export const nextSeq = (): number => ++seq;
