import { Hono } from "hono";
import type { FeedState } from "../modules/feed/asterix-feed";
import type { FusionStats } from "../modules/fusion/track-fuser";

/** Where health reads real state from; registered by index.ts once everything exists. */
export interface HealthProbe {
  feeds(): FeedState[];
  live(): { clients: number; tracks: number; flightplans: number };
  /** Null when fusion is switched off. */
  fusion?(): FusionStats | null;
  /** True when the database answered. */
  database(): Promise<boolean>;
}

export type DecoderStatus = "unconfigured" | "no_data" | "ready" | "failing";

export interface HealthReport {
  status: "ok" | "degraded";
  process: { status: "healthy"; uptimeS: number };
  feeds: Array<{
    name: string;
    transport: string;
    port: number;
    running: boolean;
    remote: string | null;
    packetsReceived: number;
    packetsUndecoded: number;
    lastError: string | null;
  }>;
  decoder: { status: DecoderStatus };
  database: { status: "up" | "down" | "unknown" };
  live: { clients: number; tracks: number; flightplans: number } | null;
  fusion: FusionStats | null;
}

/** More than this share of datagrams undecodable means the decoder (or the feed format) is wrong. */
const FAILING_UNDECODED_SHARE = 0.5;

export function decoderStatus(feeds: FeedState[]): DecoderStatus {
  if (feeds.length === 0) return "unconfigured";
  let received = 0;
  let undecoded = 0;
  for (const f of feeds) {
    received += f.stats.packetsReceived;
    undecoded += f.stats.packetsUndecoded;
  }
  if (received === 0) return "no_data";
  return undecoded / received > FAILING_UNDECODED_SHARE ? "failing" : "ready";
}

async function databaseStatus(
  probe: HealthProbe | null,
): Promise<HealthReport["database"]["status"]> {
  if (!probe) return "unknown";
  try {
    return (await probe.database()) ? "up" : "down";
  } catch {
    return "down";
  }
}

export async function buildHealth(
  probe: HealthProbe | null,
  uptimeS: number = Math.round(process.uptime()),
): Promise<HealthReport> {
  const feeds = probe?.feeds() ?? [];
  const decoder = decoderStatus(feeds);
  const database = await databaseStatus(probe);
  const feedDown = feeds.some((f) => !f.stats.running);
  const degraded = database === "down" || decoder === "failing" || feedDown;
  return {
    status: degraded ? "degraded" : "ok",
    process: { status: "healthy", uptimeS },
    feeds: feeds.map((f) => ({
      name: f.name,
      transport: f.stats.transport,
      port: f.stats.port,
      running: f.stats.running,
      remote: f.stats.remote,
      packetsReceived: f.stats.packetsReceived,
      packetsUndecoded: f.stats.packetsUndecoded,
      lastError: f.stats.lastError,
    })),
    decoder: { status: decoder },
    database: { status: database },
    live: probe?.live() ?? null,
    fusion: probe?.fusion?.() ?? null,
  };
}

let registered: HealthProbe | null = null;

export function registerHealthProbe(probe: HealthProbe | null): void {
  registered = probe;
}

// Always 200: the report says what is wrong, and a hiccup in one dependency
// should not make an orchestrator restart a process that is still serving.
const app = new Hono().get("/", async (c) =>
  c.json(await buildHealth(registered)),
);

export default app;
