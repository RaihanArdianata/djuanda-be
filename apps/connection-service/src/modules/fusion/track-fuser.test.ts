import { describe, expect, it } from "bun:test";
import type { FusedTrackEvent, Protocol } from "@aeroswarm/core";
import {
  DEFAULT_AIRBORNE_PRIORITY,
  DEFAULT_SURFACE_PRIORITY,
} from "./fusion-config";
import {
  createTrackFuser,
  distanceM,
  type FusionOptions,
  isSyntheticId,
  type TrackFuser,
} from "./track-fuser";

const RADAR = "radar";
const MLAT = "mlat";

let clock = 1_000_000;
const advance = (ms: number): void => {
  clock += ms;
};

function fuser(over: Partial<FusionOptions> = {}): TrackFuser {
  return createTrackFuser({
    surfacePriority: DEFAULT_SURFACE_PRIORITY,
    airbornePriority: DEFAULT_AIRBORNE_PRIORITY,
    maxSourceAgeMs: 5_000,
    forgetAfterMs: 600_000,
    spatial: false,
    matchRadiusM: 150,
    matchMaxSkewMs: 3_000,
    disagreeM: 300,
    now: () => clock,
    ...over,
  });
}

interface Spec {
  trackId: string;
  source: string;
  protocol: Protocol;
  icao24: string;
  lat: number;
  lon: number;
  onGround: boolean;
  callsign: string;
  lifecycle: FusedTrackEvent["lifecycle"];
}

/** A track from one sensor. Defaults describe a radar track in the air. */
function ev(over: Partial<Spec> = {}): FusedTrackEvent {
  const s: Spec = {
    trackId: "ast_radar1",
    source: RADAR,
    protocol: "asterix-cat048",
    icao24: "8a0f21",
    lat: -7.38,
    lon: 112.78,
    onGround: false,
    callsign: "",
    lifecycle: "updated",
    ...over,
  };
  return {
    trackId: s.trackId,
    sources: [s.source],
    identity: s.callsign
      ? { icao24: s.icao24, callsign: s.callsign }
      : { icao24: s.icao24 },
    protocol: s.protocol,
    position: { lat: s.lat, lon: s.lon, onGround: s.onGround },
    velocity: { groundSpeed: 120 },
    confidence: {
      overall: 0.9,
      position: 0.9,
      identity: 0.9,
      velocity: 0.9,
      sourceAgreement: 1,
      spoofRisk: 0,
    },
    fusedAt: clock,
    updatedAt: clock,
    lifecycle: s.lifecycle,
  };
}

const mlat = (over: Partial<Spec> = {}): FusedTrackEvent =>
  ev({
    trackId: "ast_mlat1",
    source: MLAT,
    protocol: "asterix-cat020",
    ...over,
  });

describe("isSyntheticId / distanceM", () => {
  it("recognises ids built from sensor and track number", () => {
    expect(isSyntheticId("r50-176-42")).toBe(true);
    expect(isSyntheticId("v1-2-3")).toBe(true);
    expect(isSyntheticId("t0-0-9")).toBe(true);
    expect(isSyntheticId("8a0f21")).toBe(false);
    expect(isSyntheticId("rabc")).toBe(false);
  });

  it("measures about 111 km per degree of latitude", () => {
    const d = distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
});

describe("one sensor", () => {
  it("passes events through under a stable track id", () => {
    const f = fuser();
    const first = f.ingest(ev());
    expect(first?.trackId).toBe("ast_radar1");
    expect(first?.sources).toEqual([RADAR]);
    expect(first?.lifecycle).toBe("updated");
    advance(1_000);
    // The feed restarts the track under a new id: the aircraft keeps its own.
    const next = f.ingest(ev({ trackId: "ast_radar2" }));
    expect(next?.trackId).toBe("ast_radar1");
  });

  it("passes a drop for an unknown track through unchanged", () => {
    const dropped = ev({ trackId: "ghost", lifecycle: "dropped" });
    expect(fuser().ingest(dropped)).toBe(dropped);
  });
});

describe("radar and MLAT see the same aircraft", () => {
  it("keeps one track id instead of replacing one with the other", () => {
    const f = fuser();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const a = f.ingest(ev());
      const b = f.ingest(mlat());
      if (a) ids.add(a.trackId);
      if (b) ids.add(b.trackId);
      advance(1_000);
    }
    expect([...ids]).toEqual(["ast_radar1"]);
  });

  it("lists both sensors and marks the track merged", () => {
    const f = fuser();
    f.ingest(ev());
    const out = f.ingest(mlat());
    expect(out?.lifecycle).toBe("merged");
    expect(new Set(out?.sources)).toEqual(new Set([RADAR, MLAT]));
    expect(f.stats()).toMatchObject({ aircraft: 1, merged: 1 });
  });

  it("shows the radar position in the air and the MLAT position on the ground", () => {
    const f = fuser();
    f.ingest(ev({ lat: -7.38 }));
    const air = f.ingest(mlat({ lat: -7.3801 }));
    // A second sensor appears, but the picture keeps the radar position.
    expect(air?.sources[0]).toBe(RADAR);
    expect(air?.position?.lat).toBe(-7.38);

    advance(500);
    const radarAir = f.ingest(ev({ lat: -7.381 }));
    expect(radarAir?.sources[0]).toBe(RADAR);
    expect(radarAir?.position?.lat).toBe(-7.381);

    advance(500);
    const ground = f.ingest(mlat({ lat: -7.382, onGround: true }));
    expect(ground?.sources[0]).toBe(MLAT);
    expect(ground?.position?.lat).toBe(-7.382);
  });

  it("does not repeat the picture when only a lower-priority sensor updates", () => {
    const f = fuser();
    f.ingest(ev());
    f.ingest(mlat());
    advance(500);
    expect(f.ingest(mlat())).toBeNull();
    expect(f.ingest(ev())).not.toBeNull();
  });

  it("falls back to the other sensor when the primary goes silent", () => {
    const f = fuser();
    f.ingest(ev());
    f.ingest(mlat());
    advance(6_000);
    const out = f.ingest(mlat({ lat: -7.39 }));
    expect(out?.sources).toEqual([MLAT]);
    expect(out?.lifecycle).toBe("updated");
    expect(out?.position?.lat).toBe(-7.39);
    expect(out?.trackId).toBe("ast_radar1");
  });

  it("fills identity from whichever sensor has it", () => {
    const f = fuser();
    f.ingest(ev());
    const out = f.ingest(mlat({ callsign: "GIA123" }));
    expect(out?.sources[0]).toBe(RADAR);
    expect(out?.identity.callsign).toBe("GIA123");
  });

  it("prefers the real Mode-S address over a synthetic one", () => {
    const f = fuser({ spatial: true });
    f.ingest(ev({ icao24: "r50-176-42" }));
    const out = f.ingest(mlat({ icao24: "8a0f21" }));
    expect(out?.identity.icao24).toBe("8a0f21");
  });

  it("scores how well the sensors agree and counts the ones that do not", () => {
    const f = fuser();
    f.ingest(ev({ lat: -7.38 }));
    const close = f.ingest(mlat({ lat: -7.38 }));
    expect(close?.confidence.sourceAgreement).toBe(1);
    expect(f.stats().disagreements).toBe(0);

    advance(100);
    const far = f.ingest(mlat({ lat: -7.39, onGround: true }));
    expect(far?.confidence.sourceAgreement).toBe(0);
    expect(f.stats().disagreements).toBe(1);
  });

  it("honours a custom priority", () => {
    const f = fuser({ airbornePriority: ["mlat"] });
    f.ingest(ev());
    const out = f.ingest(mlat({ lat: -7.5 }));
    expect(out?.sources[0]).toBe(MLAT);
    expect(out?.position?.lat).toBe(-7.5);
  });
});

describe("a sensor drops the track", () => {
  it("keeps the aircraft while another sensor still sees it", () => {
    const f = fuser();
    f.ingest(ev());
    f.ingest(mlat());
    const out = f.ingest(ev({ lifecycle: "dropped" }));
    expect(out?.lifecycle).not.toBe("dropped");
    expect(out?.sources).toEqual([MLAT]);
    expect(out?.trackId).toBe("ast_radar1");
  });

  it("drops the canonical track when the last sensor lets go", () => {
    const f = fuser();
    f.ingest(ev());
    f.ingest(mlat());
    f.ingest(ev({ lifecycle: "dropped" }));
    const out = f.ingest(mlat({ lifecycle: "dropped" }));
    expect(out?.lifecycle).toBe("dropped");
    expect(out?.trackId).toBe("ast_radar1");
    expect(f.stats().aircraft).toBe(0);
  });
});

describe("tracks without a shared Mode-S address", () => {
  const radarSynthetic = (over: Partial<Spec> = {}): FusedTrackEvent =>
    ev({ icao24: "r50-176-42", ...over });
  const mlatSynthetic = (over: Partial<Spec> = {}): FusedTrackEvent =>
    mlat({ icao24: "v1-2-7", ...over });

  it("stay separate by default", () => {
    const f = fuser();
    const a = f.ingest(radarSynthetic());
    const b = f.ingest(mlatSynthetic());
    expect(a?.trackId).not.toBe(b?.trackId);
    expect(f.stats().aircraft).toBe(2);
  });

  it("merge by position and time when spatial matching is on", () => {
    const f = fuser({ spatial: true });
    f.ingest(radarSynthetic());
    advance(1_000);
    const out = f.ingest(mlatSynthetic({ lat: -7.3801 }));
    expect(out?.trackId).toBe("ast_radar1");
    expect(f.stats()).toMatchObject({ aircraft: 1, spatialMatches: 1 });
    // The next report from the same sensor is recognised by its own id,
    // without another search.
    advance(1_000);
    f.ingest(mlatSynthetic({ lat: -7.3802 }));
    expect(f.stats()).toMatchObject({ aircraft: 1, spatialMatches: 1 });
  });

  it("do not merge when too far apart or too long ago", () => {
    const far = fuser({ spatial: true });
    far.ingest(radarSynthetic());
    far.ingest(mlatSynthetic({ lat: -7.39 }));
    expect(far.stats().aircraft).toBe(2);

    const late = fuser({ spatial: true });
    late.ingest(radarSynthetic());
    advance(4_000);
    late.ingest(mlatSynthetic());
    expect(late.stats().aircraft).toBe(2);
  });

  it("are left alone when two aircraft are equally close", () => {
    const f = fuser({ spatial: true });
    f.ingest(radarSynthetic({ trackId: "a", icao24: "r1-1-1" }));
    f.ingest(radarSynthetic({ trackId: "b", icao24: "r1-1-2", lon: 112.7801 }));
    // Same sensor twice: neither is a partner, so the MLAT track stands alone.
    f.ingest(mlatSynthetic({ trackId: "m", lon: 112.78005 }));
    expect(f.stats().aircraft).toBe(3);
  });

  it("never join two different Mode-S addresses", () => {
    const f = fuser({ spatial: true });
    f.ingest(ev({ icao24: "aaaaaa" }));
    f.ingest(mlat({ icao24: "bbbbbb" }));
    expect(f.stats().aircraft).toBe(2);
  });
});

describe("cleanup", () => {
  it("forget removes a track and its links", () => {
    const f = fuser();
    f.ingest(ev());
    f.forget("ast_radar1");
    expect(f.stats().aircraft).toBe(0);
    // A new report starts a new canonical track.
    expect(f.ingest(ev({ trackId: "ast_new" }))?.trackId).toBe("ast_new");
  });

  it("sweep forgets silent sensors and empty tracks", () => {
    const f = fuser({ forgetAfterMs: 10_000 });
    f.ingest(ev());
    advance(5_000);
    f.ingest(mlat());
    advance(6_000);
    f.sweep();
    // Radar (11 s old) is forgotten, MLAT (6 s old) stays.
    expect(f.stats().aircraft).toBe(1);
    advance(5_000);
    f.sweep();
    expect(f.stats().aircraft).toBe(0);
  });
});
