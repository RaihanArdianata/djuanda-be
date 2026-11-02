import { describe, expect, it } from "bun:test";
import type { FusedTrackEvent } from "@aeroswarm/core";
import type { CurrentTrack } from "@aeroswarm/core/types";
import { createTrackState } from "@aeroswarm/live-server";
import {
  applySurfaceState,
  createSurfaceStateStore,
  deriveOnGround,
} from "./surface-state";

const fused = (opts: {
  onGround?: boolean;
  alt?: number;
  gs?: number;
  vehicle?: boolean;
  lifecycle?: FusedTrackEvent["lifecycle"];
}): FusedTrackEvent =>
  ({
    trackId: "t1",
    sources: ["asterix-udp"],
    identity: {
      icao24: "8a1812",
      ...(opts.vehicle ? { targetType: "vehicle" } : {}),
    },
    protocol: "asterix-cat020",
    position: {
      lat: -7.37,
      lon: 112.79,
      ...(opts.alt !== undefined ? { alt: opts.alt } : {}),
      ...(opts.onGround !== undefined ? { onGround: opts.onGround } : {}),
    },
    velocity:
      opts.gs !== undefined ? { groundSpeed: opts.gs, heading: 0 } : undefined,
    fusedAt: 1,
    updatedAt: 1,
    lifecycle: opts.lifecycle ?? "updated",
  }) as unknown as FusedTrackEvent;

describe("deriveOnGround", () => {
  it("trusts an explicit true and always treats vehicles as on the ground", () => {
    expect(deriveOnGround(fused({ onGround: true, alt: 3000, gs: 200 }))).toBe(
      true,
    );
    expect(
      deriveOnGround(
        fused({ vehicle: true, onGround: false, alt: 800, gs: 90 }),
      ),
    ).toBe(true);
  });

  it("corrects a taxiing target the feed marked airborne", () => {
    // The BTK6391-style case: onGround=false, 0 ft, 4 kt.
    expect(deriveOnGround(fused({ onGround: false, alt: 0, gs: 4 }))).toBe(
      true,
    );
    expect(deriveOnGround(fused({ alt: 0, gs: 12 }))).toBe(true);
  });

  it("keeps a fast target airborne or unknown: the takeoff roll is not parked", () => {
    expect(deriveOnGround(fused({ onGround: false, alt: 0, gs: 106 }))).toBe(
      false,
    );
    expect(deriveOnGround(fused({ alt: 0, gs: 106 }))).toBeUndefined();
    expect(deriveOnGround(fused({ onGround: false, alt: 225, gs: 79 }))).toBe(
      false,
    );
  });

  it("says airborne above 500 ft even without a flag, and unknown in between", () => {
    expect(deriveOnGround(fused({ alt: 1700, gs: 178 }))).toBe(false);
    expect(deriveOnGround(fused({ alt: 300, gs: 60 }))).toBeUndefined();
  });

  it("does not call a slow hover above 100 ft on the ground", () => {
    expect(deriveOnGround(fused({ onGround: false, alt: 300, gs: 20 }))).toBe(
      false,
    );
  });

  it("gives no answer without any data", () => {
    expect(deriveOnGround(fused({}))).toBeUndefined();
  });
});

describe("negative altitude", () => {
  it("is clamped to 0 instead of being shown as below sea level", () => {
    const out = applySurfaceState(fused({ onGround: true, alt: -100, gs: 62 }));
    expect(out.position?.alt).toBe(0);
  });

  it("leaves zero and positive altitudes, and missing ones, alone", () => {
    const zero = fused({ onGround: true, alt: 0, gs: 0 });
    expect(applySurfaceState(zero)).toBe(zero);
    expect(
      applySurfaceState(fused({ onGround: false, alt: 1200, gs: 150 })).position
        ?.alt,
    ).toBe(1200);
    expect(
      applySurfaceState(fused({ onGround: true, gs: 0 })).position?.alt,
    ).toBeUndefined();
  });

  it("still derives the ground state from the clamped value", () => {
    const out = applySurfaceState(fused({ onGround: false, alt: -100, gs: 4 }));
    expect(out.position).toMatchObject({ alt: 0, onGround: true });
  });
});

describe("applySurfaceState", () => {
  it("writes the derived value into position.onGround", () => {
    const out = applySurfaceState(fused({ onGround: false, alt: 0, gs: 4 }));
    expect(out.position?.onGround).toBe(true);
  });

  it("returns the same event when nothing changes, and leaves removals alone", () => {
    const settled = fused({ onGround: true, alt: 0, gs: 0 });
    expect(applySurfaceState(settled)).toBe(settled);
    const dropped = fused({
      onGround: false,
      alt: 0,
      gs: 0,
      lifecycle: "dropped",
    });
    expect(applySurfaceState(dropped)).toBe(dropped);
    const unknown = fused({});
    expect(applySurfaceState(unknown)).toBe(unknown);
  });
});

describe("surface state store", () => {
  const track = (): CurrentTrack =>
    ({ trackId: "t1", icao24: "8a1812", callsign: null }) as CurrentTrack;

  it("adds onGround to a track that has a known state", () => {
    const store = createSurfaceStateStore();
    store.set("t1", true);
    expect(
      (store.attach(track()) as CurrentTrack & { onGround?: boolean }).onGround,
    ).toBe(true);
    store.set("t1", false);
    expect(
      (store.attach(track()) as CurrentTrack & { onGround?: boolean }).onGround,
    ).toBe(false);
  });

  it("leaves unknown tracks alone and forgets removed ones", () => {
    const store = createSurfaceStateStore();
    const t = track();
    expect(store.attach(t)).toBe(t);
    store.set("t1", true);
    store.set("t1", undefined);
    expect(store.size).toBe(0);
    store.set("t1", true);
    store.forget("t1");
    expect(store.attach(t)).toBe(t);
  });
});

describe("with the live picture", () => {
  it("sends the normalised onGround to clients with the track", () => {
    const store = createSurfaceStateStore();
    const state = createTrackState({
      staleAfterMs: 60_000,
      lostAfterMs: 120_000,
      removeAfterMs: 300_000,
      attachFlightPlan: store.attach,
    });
    const now = Date.now();
    const raw = {
      ...fused({ onGround: false, alt: 0, gs: 4 }),
      fusedAt: now,
      updatedAt: now,
      confidence: {
        overall: 0.9,
        position: 0.9,
        identity: 0.9,
        velocity: 0.9,
        sourceAgreement: 1,
        spoofRisk: 0,
      },
    } as FusedTrackEvent;

    const normalized = applySurfaceState(raw);
    store.set(normalized.trackId, normalized.position?.onGround);
    state.ingest(normalized);

    expect(
      (state.get("t1") as CurrentTrack & { onGround?: boolean }).onGround,
    ).toBe(true);
  });
});
