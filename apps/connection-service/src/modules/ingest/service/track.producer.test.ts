import { describe, expect, it } from "bun:test";
import { toFullTrackMessages } from "./track.producer";

describe("toFullTrackMessages", () => {
  it("keeps every field of the event, keyed by trackId", () => {
    const event = {
      trackId: "ast_1",
      airportId: "WARR",
      fusedAt: 1,
      identity: { icao24: "8a0123", callsign: "GIA303" },
      position: { lat: -7.38, lon: 112.78, onGround: true },
      sources: ["asterix-udp"],
      confidence: { overall: 0.9 },
    };
    const [msg] = toFullTrackMessages([event]);
    expect(msg?.key).toBe("ast_1");
    expect(JSON.parse(msg?.value ?? "{}")).toEqual(event);
  });

  it("skips events without a usable trackId", () => {
    expect(
      toFullTrackMessages([null, {}, { trackId: "" }, { trackId: 5 }]),
    ).toEqual([]);
  });
});
