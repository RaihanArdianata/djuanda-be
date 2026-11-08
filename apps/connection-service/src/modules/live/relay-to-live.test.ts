import { describe, expect, it } from "bun:test";
import type { FusedTrackEvent } from "@aeroswarm/core";
import { createRelayToLive, relayToLiveEnabled } from "./relay-to-live";

const event = (id = "relay-1"): FusedTrackEvent =>
  ({
    trackId: id,
    identity: { icao24: "8a0aaa" },
    sources: ["relay"],
    protocol: "adsb",
  }) as unknown as FusedTrackEvent;

describe("relayToLiveEnabled", () => {
  it("is on unless switched off", () => {
    expect(relayToLiveEnabled({})).toBe(true);
    expect(relayToLiveEnabled({ RELAY_TO_LIVE: "true" })).toBe(true);
    for (const off of ["false", "0", "off", "no", " FALSE "])
      expect(relayToLiveEnabled({ RELAY_TO_LIVE: off })).toBe(false);
  });
});

describe("createRelayToLive", () => {
  it("normalises, fuses and hands the track to the live picture", () => {
    const shown: FusedTrackEvent[] = [];
    const forward = createRelayToLive({
      enabled: true,
      normalize: (e) => ({
        ...e,
        identity: { ...e.identity, callsign: "CTV351" },
      }),
      fuse: (e) => ({ ...e, trackId: "canonical" }),
      onTrack: (e) => shown.push(e),
    });
    forward(event());
    expect(shown).toHaveLength(1);
    expect(shown[0]?.trackId).toBe("canonical");
    expect(shown[0]?.identity.callsign).toBe("CTV351");
  });

  it("does nothing when switched off", () => {
    const shown: FusedTrackEvent[] = [];
    createRelayToLive({
      enabled: false,
      normalize: (e) => e,
      fuse: (e) => e,
      onTrack: (e) => shown.push(e),
    })(event());
    expect(shown).toEqual([]);
  });

  it("shows nothing when fusion says the event adds nothing, but still reports it was forwarded", () => {
    const shown: FusedTrackEvent[] = [];
    const seen: (FusedTrackEvent | null)[] = [];
    createRelayToLive({
      enabled: true,
      normalize: (e) => e,
      fuse: () => null,
      onTrack: (e) => shown.push(e),
      onForwarded: (_e, fused) => seen.push(fused),
    })(event());
    expect(shown).toEqual([]);
    expect(seen).toEqual([null]);
  });

  it("never throws into the ingest path, whatever the live picture does", () => {
    const forward = createRelayToLive({
      enabled: true,
      normalize: (e) => e,
      fuse: (e) => e,
      onTrack: () => {
        throw new Error("live picture broke");
      },
    });
    expect(() => forward(event())).not.toThrow();
  });
});
