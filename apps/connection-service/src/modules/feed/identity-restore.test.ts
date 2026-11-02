import { describe, expect, it } from "bun:test";
import type { FusedTrackEvent } from "@aeroswarm/core";
import { createIdentityMemory } from "./identity-memory";
import { restoreIdentities } from "./identity-restore";

const bare = (icao24: string): FusedTrackEvent =>
  ({
    trackId: "t",
    sources: ["asterix-udp"],
    identity: { icao24 },
    protocol: "asterix-cat020",
    position: { lat: 0, lon: 0, alt: 0 },
    velocity: { groundSpeed: 0, heading: 0 },
    fusedAt: 1,
    updatedAt: 1,
    lifecycle: "updated",
  }) as unknown as FusedTrackEvent;

describe("restoreIdentities", () => {
  it("fills the memory so an aircraft keeps its name right after a restart", async () => {
    const now = 1_000_000;
    const memory = createIdentityMemory({ clock: () => now });
    const asked: Date[] = [];
    const result = await restoreIdentities(
      memory,
      async (since) => {
        asked.push(since);
        return [
          { icao24: "8a1812", callsign: "BTK7508", at: now - 60_000 },
          { icao24: "", callsign: "X", at: now },
          { icao24: "8a0378", callsign: "LNI971", at: now - 120_000 },
        ];
      },
      30 * 60_000,
      now,
    );

    expect(result).toEqual({ rows: 3, restored: 2 });
    expect(asked[0]?.getTime()).toBe(now - 30 * 60_000);
    expect(memory.fill(bare("8A1812")).identity?.callsign).toBe("BTK7508");
    expect(memory.fill(bare("8a0378")).identity?.callsign).toBe("LNI971");
  });

  it("is harmless when there is nothing stored", async () => {
    const memory = createIdentityMemory();
    expect(await restoreIdentities(memory, async () => [])).toEqual({
      rows: 0,
      restored: 0,
    });
    expect(memory.size).toBe(0);
  });
});
