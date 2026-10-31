import { afterEach, describe, expect, it } from "bun:test";
import { createSocket } from "node:dgram";
import {
  getFeedStates,
  startAsterixFeeds,
  stopAsterixFeeds,
} from "../feed/asterix-feed";
import { liveConfigFromEnv } from "./live-config";
import { createLiveRuntime, type LiveRuntime } from "./live-runtime";

/** Synthetic CAT010 surface report for a vehicle at lat/lon; same sensor and track number each time. */
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

// The Juanda zone suggested in .env.example (10 NM around the airport).
const BBOX = "112.619,-7.546,112.955,-7.213";
const INSIDE = { lat: -7.38, lon: 112.78 };
const OUTSIDE = { lat: -7.38, lon: 113.4 };

describe("an aircraft that leaves the interest zone disappears (real UDP feed, published packages)", () => {
  let runtime: LiveRuntime | undefined;
  afterEach(async () => {
    await stopAsterixFeeds();
    runtime?.stop();
    runtime = undefined;
  });

  async function start(env: Record<string, string> = {}) {
    const config = liveConfigFromEnv({
      INTEREST_BBOX: BBOX,
      INTEREST_LOOKAHEAD_MIN: "15",
      EXIT_MARGIN_M: "0",
      EXIT_CONFIRM_FIXES: "1",
      ...env,
    });
    runtime = createLiveRuntime({ authenticate: () => null, config });
    const removed: Array<{ trackId: string; reason: string }> = [];
    runtime.state.on("removed", (e) => removed.push(e));

    const port = await freeUdpPort();
    startAsterixFeeds({
      env: {
        AEROSWARM_FEED_UDP_PORT: String(port),
        AEROSWARM_FEED_UDP_HOST: "127.0.0.1",
        ASTERIX_ALLOWED_CATS: "10",
      },
      persist: () => {},
      handlers: runtime.feedHandlers,
    });
    await until(() => getFeedStates()[0]?.stats.running === true);
    const report = async (
      p: { lat: number; lon: number },
      expected: number,
    ) => {
      await sendUdp(port, cat10(p.lat, p.lon));
      await until(
        () => (getFeedStates()[0]?.stats.packetsReceived ?? 0) >= expected,
      );
    };
    return { runtime, removed, report };
  }

  it("is removed as 'exited' the moment it is seen outside, and stays gone", async () => {
    const { runtime: r, removed, report } = await start();

    await report(INSIDE, 1);
    await until(() => r.state.size === 1);

    await report(OUTSIDE, 2);
    await until(() => r.state.size === 0);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.reason).toBe("exited");

    // Reports from the same vehicle, even back inside the box, are ignored for suppressMs.
    await report(INSIDE, 3);
    await new Promise((res) => setTimeout(res, 100));
    expect(r.state.size).toBe(0);
    expect(removed).toHaveLength(1);
  });

  it("with the exit rule switched off the aircraft is not removed by leaving", async () => {
    const {
      runtime: r,
      removed,
      report,
    } = await start({ EXIT_REMOVE_ENABLED: "false" });
    await report(INSIDE, 1);
    await until(() => r.state.size === 1);
    // Outside and heading away (the vehicle has no speed, so it is not "heading in"): the
    // interest rule alone removes it as "filtered", not "exited".
    await report(OUTSIDE, 2);
    await until(() => r.state.size === 0);
    expect(removed[0]?.reason).toBe("filtered");
  });

  it("an aircraft that never entered the zone is never shown", async () => {
    const { runtime: r, removed, report } = await start();
    await report(OUTSIDE, 1);
    await new Promise((res) => setTimeout(res, 100));
    expect(r.state.size).toBe(0);
    expect(removed).toHaveLength(0);
  });
});
