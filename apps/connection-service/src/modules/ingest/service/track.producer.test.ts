import { describe, expect, it } from "bun:test";
import { toFullTrackMessages } from "./track.producer";

const parse = (m: { value: string } | undefined): Record<string, unknown> =>
  JSON.parse(m?.value ?? "{}");

describe("toFullTrackMessages", () => {
  const mlat = {
    trackId: "ast_1",
    airportId: "WARR",
    sources: ["mlat"],
    identity: { icao24: "8a082b", callsign: "LNI260", squawk: "6342" },
    position: { lat: -7.38, lon: 112.79, alt: 50, onGround: true },
    velocity: { groundSpeed: 8, heading: 150, verticalRate: 0 },
    details: { trackNumber: 2414 },
    dataSource: { sac: 1, sic: 1 },
    meta: { port: 18600 },
  };

  it("keeps every reported field and keys the message by trackId", () => {
    const [msg] = toFullTrackMessages([mlat]);
    const out = parse(msg) as typeof mlat;
    expect(msg?.key).toBe("ast_1");
    expect(out.identity.callsign).toBe("LNI260");
    expect(out.position.lat).toBe(-7.38);
    expect(out.velocity.verticalRate).toBe(0);
    expect(out.meta).toEqual({ port: 18600 });
  });

  it("emits null, not a missing key, for what the sensor did not send", () => {
    const out = parse(toFullTrackMessages([mlat])[0]) as Record<
      string,
      Record<string, unknown>
    >;
    expect(out.identity?.aircraftType).toBeNull();
    expect(out.identity?.wake).toBeNull();
    expect(out.identity?.targetType).toBeNull();
    expect(out.route).toEqual({ adep: null, ades: null });
    expect(out.details?.emitterCategory).toBeNull();
    expect(out.details?.trackNumber).toBe(2414);
    expect(out.position?.altSource).toBeNull();
  });

  it("keeps zero and false as they are", () => {
    const out = parse(
      toFullTrackMessages([
        {
          trackId: "ast_2",
          position: { lat: 0, lon: 0, onGround: false },
          velocity: { groundSpeed: 0 },
        },
      ])[0],
    ) as Record<string, Record<string, unknown>>;
    expect(out.position?.lat).toBe(0);
    expect(out.position?.onGround).toBe(false);
    expect(out.velocity?.groundSpeed).toBe(0);
    expect(out.velocity?.heading).toBeNull();
  });

  it("fills the groups even when the event has none", () => {
    const out = parse(toFullTrackMessages([{ trackId: "ast_3" }])[0]);
    expect(out.dataSource).toEqual({ sac: null, sic: null });
    expect(out.position).toEqual({
      lat: null,
      lon: null,
      alt: null,
      altSource: null,
      onGround: null,
    });
  });

  it("skips events without a usable trackId", () => {
    expect(
      toFullTrackMessages([null, {}, { trackId: "" }, { trackId: 5 }]),
    ).toEqual([]);
  });
});
