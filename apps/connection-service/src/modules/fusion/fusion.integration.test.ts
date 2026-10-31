import { afterEach, describe, expect, it } from "bun:test";
import { createSocket } from "node:dgram";
import type { FusedTrackEvent } from "@aeroswarm/core";
import { createTrackFuser, createTrackState } from "@aeroswarm/live-server";
import {
  getFeedStates,
  startAsterixFeeds,
  stopAsterixFeeds,
} from "../feed/asterix-feed";
import { fusionConfigFromEnv } from "./fusion-config";

// Real captured CAT021 report (MAS179, Mode-S 75021b).
const CAT21 = Buffer.from(
  "15002fffa35b0220b100286cbde60009e2d0010f228475021b17f000070805a0000008e6c6733414f1df982000003e",
  "hex",
);

async function freeUdpPort(): Promise<number> {
  const s = createSocket("udp4");
  await new Promise<void>((r) => s.bind(0, "127.0.0.1", () => r()));
  const port = s.address().port;
  s.close();
  return port;
}

async function sendUdp(port: number, data: Buffer): Promise<void> {
  const s = createSocket("udp4");
  await new Promise<void>((r) => s.send(data, port, "127.0.0.1", () => r()));
  s.close();
}

async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 15));
  }
}

const pause = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Two sensors, two real UDP sockets, the same aircraft: the situation of a
 * radar and an MLAT feed. The pipeline is wired the way index.ts wires it.
 */
async function twoSensors(withFusion: boolean): Promise<{
  removed: Array<{ trackId: string; reason: string }>;
  stored: FusedTrackEvent[];
  updates: string[];
  tracks: Array<{ trackId: string }>;
  ports: [number, number];
}> {
  const ports: [number, number] = [await freeUdpPort(), await freeUdpPort()];
  const state = createTrackState({});
  const removed: Array<{ trackId: string; reason: string }> = [];
  const updates: string[] = [];
  state.on("removed", (e) => removed.push(e));
  state.on("update", (e) => updates.push(e.trackId));
  const stored: FusedTrackEvent[] = [];
  const fuser = withFusion
    ? createTrackFuser(fusionConfigFromEnv({}).options)
    : null;

  startAsterixFeeds({
    env: {
      AEROSWARM_AIRPORT_ID: "WARR",
      ASTERIX_FORCED_EDITIONS: "21:0.26",
      ASTERIX_FEEDS: JSON.stringify([
        {
          name: "radar",
          transport: "udp",
          port: ports[0],
          bindHost: "127.0.0.1",
        },
        {
          name: "mlat",
          transport: "udp",
          port: ports[1],
          bindHost: "127.0.0.1",
        },
      ]),
    },
    fuse: fuser ? (e) => fuser.ingest(e) : undefined,
    persist: (e) => {
      stored.push(e as unknown as FusedTrackEvent);
    },
    handlers: { onTrack: (e) => state.ingest(e) },
  });
  await until(
    () =>
      getFeedStates().length === 2 &&
      getFeedStates().every((f) => f.stats.running),
  );

  // The sensors report in turn, as two real feeds would.
  for (let i = 0; i < 4; i++) {
    await sendUdp(ports[0], CAT21);
    await pause(40);
    await sendUdp(ports[1], CAT21);
    await pause(40);
  }
  await until(
    () =>
      getFeedStates().every((f) => f.stats.packetsReceived >= 4) &&
      stored.length >= 4,
  );
  return { removed, stored, updates, tracks: [...state.values()], ports };
}

describe("radar + MLAT on real sockets", () => {
  afterEach(async () => {
    await stopAsterixFeeds();
  });

  it("without fusion the two feeds knock each other's track out", async () => {
    const r = await twoSensors(false);
    // This is the fault the fuser exists to remove.
    expect(r.removed.length).toBeGreaterThan(0);
    expect(r.removed.every((x) => x.reason === "superseded")).toBe(true);
    expect(new Set(r.stored.map((e) => e.trackId)).size).toBe(2);
  });

  it("with fusion there is one stable track and nothing is removed", async () => {
    const r = await twoSensors(true);
    expect(r.removed).toEqual([]);
    expect(r.tracks).toHaveLength(1);
    expect(new Set(r.stored.map((e) => e.trackId)).size).toBe(1);
    expect(new Set(r.updates).size).toBe(1);
  });

  it("names both sensors on the merged track", async () => {
    const r = await twoSensors(true);
    const last = r.stored.at(-1);
    expect(last?.identity.icao24).toBe("75021b");
    expect(last?.lifecycle).toBe("merged");
    expect(new Set(last?.sources)).toEqual(new Set(["radar", "mlat"]));
  });
});
