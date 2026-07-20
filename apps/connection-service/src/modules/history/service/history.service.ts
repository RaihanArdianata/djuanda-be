import {
  createInMemoryCheckpointStore,
  createPostgresStore,
  createReplayServer,
} from "@aeroswarm/replay-server";

// Monitor tokens are minted by AeroSwarm when a connector is created for
// this airport (Connectors tab → "monitor token", shown once) — paste them
// into AEROSWARM_MONITOR_TOKENS (comma-separated). Static allowlist is the
// deliberate v1; live introspection against AeroSwarm is a later
// improvement. See aeroswarm-project/docs/development/federation/004-*.md.
const MONITOR_TOKENS = (process.env.AEROSWARM_MONITOR_TOKENS || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

export function isValidMonitorToken(token: string | null): boolean {
  return token !== null && MONITOR_TOKENS.includes(token);
}

// dbudara's aeroswarm_tracks/aeroswarm_alerts live in the default (public)
// schema with the adapter's default table names — no extra config needed.
export const replayStore = createPostgresStore({
  url: process.env.DATABASE_URL || "",
});

// In-memory checkpoints: session resume (?sessionId=) survives reconnects
// but not a process restart — acceptable, resume then just starts fresh.
export const replayCheckpoints = createInMemoryCheckpointStore();

export const replayServer = createReplayServer({
  store: replayStore,
  checkpoints: replayCheckpoints,
  validateToken: async (token) => (isValidMonitorToken(token) ? {} : null),
});

// Per-connection envelope sequence numbers (see ReplaySession) — one shared
// monotonic counter, same as AeroSwarm's own WS layer.
let seq = 0;
export const nextSeq = (): number => ++seq;
