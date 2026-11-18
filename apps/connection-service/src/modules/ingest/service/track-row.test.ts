import { describe, expect, it } from "bun:test";
import { toTrackRow } from "./track-row";

describe("toTrackRow", () => {
  it("fills the typed columns from the event and keeps the whole event as data", () => {
    const event = {
      trackId: "ast_1",
      airportId: "WARR",
      lifecycle: "merged",
      fusedAt: 1_762_000_000_000,
      protocol: "asterix-cat062",
      dataSource: { sac: 38, sic: 51 },
      identity: {
        icao24: "8a0603",
        callsign: "BTK7158",
        aircraftType: "A320",
        targetType: "aircraft",
      },
      position: { lat: -6.12, lon: 106.65, alt: 200, onGround: true },
      velocity: { groundSpeed: 20 },
      details: { trackNumber: 35424 },
    };
    const row = toTrackRow(event);

    expect(row.fusedAt).toEqual(new Date(1_762_000_000_000));
    expect(row).toMatchObject({
      trackId: "ast_1",
      airportId: "WARR",
      lifecycle: "merged",
      targetType: "aircraft",
      altitudeFt: 200,
      groundSpeedKt: 20,
      onGround: true,
      icao24: "8a0603",
      callsign: "BTK7158",
      aircraftType: "A320",
      lat: -6.12,
      lon: 106.65,
      trackNumber: 35424,
      protocol: "asterix-cat062",
      sac: 38,
      sic: 51,
    });
    expect(row.data).toBe(event);
  });

  it("uses NULL for what the event does not have, never a made-up value", () => {
    const row = toTrackRow({
      trackId: "t",
      fusedAt: 1,
      identity: { icao24: "", callsign: "" },
    });
    expect(row.icao24).toBeNull();
    expect(row.callsign).toBeNull();
    for (const key of [
      "aircraftType",
      "lat",
      "lon",
      "trackNumber",
      "protocol",
      "sac",
      "sic",
      "altitudeFt",
      "onGround",
      "targetType",
    ] as const) {
      expect(row[key]).toBeNull();
    }
  });
});

describe("toTrackRow with decoded items", () => {
  it("keeps the raw ASTERIX items out of the stored event", () => {
    const event = {
      trackId: "ast_9",
      fusedAt: 1_762_000_000_000,
      meta: {
        port: 18600,
        asterix: { category: 20, items: { "010": { SAC: 1 } } },
      },
    };
    const row = toTrackRow(event);
    expect((row.data as { meta: Record<string, unknown> }).meta).toEqual({
      port: 18600,
    });
    // The event the Kafka full topic gets is not touched.
    expect(event.meta.asterix.category).toBe(20);
  });
});
