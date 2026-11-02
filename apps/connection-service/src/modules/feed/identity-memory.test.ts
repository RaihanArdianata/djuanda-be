import { describe, expect, it } from "bun:test";
import type { FusedTrackEvent } from "@aeroswarm/core";
import { createIdentityMemory } from "./identity-memory";

const TTL = 30 * 60_000;

const event = (
  identity: FusedTrackEvent["identity"],
  lifecycle: FusedTrackEvent["lifecycle"] = "updated",
): FusedTrackEvent =>
  ({
    trackId: "ast_x",
    sources: ["asterix-udp"],
    identity,
    protocol: "asterix-cat020",
    position: { lat: -7.37, lon: 112.79, alt: 0 },
    velocity: { groundSpeed: 0, heading: 0 },
    fusedAt: 1,
    updatedAt: 1,
    lifecycle,
  }) as unknown as FusedTrackEvent;

describe("identity memory", () => {
  it("restores the callsign on an update that carries none", () => {
    let now = 0;
    const memory = createIdentityMemory(TTL, () => now);
    memory.fill(event({ icao24: "8a1812", callsign: "BTK7508" }));
    now = 5_000;
    const out = memory.fill(event({ icao24: "8A1812" }));
    expect(out.identity?.callsign).toBe("BTK7508");
    expect(out.identity?.icao24).toBe("8A1812");
  });

  it("lets a new callsign win over the remembered one", () => {
    const memory = createIdentityMemory();
    memory.fill(event({ icao24: "8a1812", callsign: "BTK7508" }));
    memory.fill(event({ icao24: "8a1812", callsign: "BTK7509" }));
    expect(memory.fill(event({ icao24: "8a1812" })).identity?.callsign).toBe(
      "BTK7509",
    );
  });

  it("treats a blank callsign as missing", () => {
    const memory = createIdentityMemory();
    memory.fill(event({ icao24: "8a1812", callsign: "BTK7508" }));
    expect(
      memory.fill(event({ icao24: "8a1812", callsign: "   " })).identity
        ?.callsign,
    ).toBe("BTK7508");
  });

  it("does not mix up different aircraft", () => {
    const memory = createIdentityMemory();
    memory.fill(event({ icao24: "8a1812", callsign: "BTK7508" }));
    const other = event({ icao24: "8a0378" });
    expect(memory.fill(other)).toBe(other);
  });

  it("keeps the memory alive while the aircraft is still being seen", () => {
    let now = 0;
    const memory = createIdentityMemory(TTL, () => now);
    memory.fill(event({ icao24: "8a1812", callsign: "BTK7508" }));
    for (let i = 0; i < 4; i++) {
      now += TTL - 1_000; // each update lands just inside the window
      expect(memory.fill(event({ icao24: "8a1812" })).identity?.callsign).toBe(
        "BTK7508",
      );
    }
  });

  it("forgets an aircraft that has not been seen for longer than the ttl", () => {
    let now = 0;
    const memory = createIdentityMemory(TTL, () => now);
    memory.fill(event({ icao24: "8a1812", callsign: "BTK7508" }));
    now = TTL + 1;
    const bare = event({ icao24: "8a1812" });
    expect(memory.fill(bare)).toBe(bare);
    memory.sweep(now);
    expect(memory.size).toBe(0);
  });

  it("leaves events without an icao24 and removal notices alone", () => {
    const memory = createIdentityMemory();
    memory.fill(event({ icao24: "8a1812", callsign: "BTK7508" }));
    const noAddress = event({} as unknown as FusedTrackEvent["identity"]);
    expect(memory.fill(noAddress)).toBe(noAddress);
    const dropped = event({ icao24: "8a1812" }, "dropped");
    expect(memory.fill(dropped)).toBe(dropped);
  });
});
