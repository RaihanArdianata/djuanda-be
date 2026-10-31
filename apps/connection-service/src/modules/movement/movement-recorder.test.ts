import { describe, expect, it } from "bun:test";
import type { FusedTrackEvent } from "@aeroswarm/core";
import type { MovementEvent } from "@aeroswarm/live-server";
import {
  createMovementRecorder,
  toMovementIngestEvent,
} from "./movement-recorder";

const track = (
  at: number,
  over: {
    alt?: number;
    gs?: number;
    onGround?: boolean;
    lifecycle?: FusedTrackEvent["lifecycle"];
    targetType?: "aircraft" | "vehicle";
    trackId?: string;
    noPosition?: boolean;
  } = {},
): FusedTrackEvent =>
  ({
    trackId: over.trackId ?? "t1",
    sources: ["asterix-udp"],
    airportId: "WARR",
    identity: {
      icao24: "8a0f21",
      callsign: "GIA123",
      ...(over.targetType && { targetType: over.targetType }),
    },
    protocol: "asterix-cat021",
    position: over.noPosition
      ? undefined
      : {
          lat: -7.38,
          lon: 112.78,
          alt: over.alt ?? 0,
          ...(over.onGround !== undefined && { onGround: over.onGround }),
        },
    velocity: { groundSpeed: over.gs ?? 0, heading: 90 },
    confidence: {
      overall: 0.9,
      position: 0.9,
      identity: 0.9,
      velocity: 0.9,
      sourceAgreement: 1,
      spoofRisk: 0,
    },
    fusedAt: at,
    updatedAt: at,
    lifecycle: over.lifecycle ?? "updated",
  }) as FusedTrackEvent;

const setup = () => {
  const events: MovementEvent[] = [];
  const rec = createMovementRecorder({ onMovement: (e) => events.push(e) });
  return { rec, events };
};

describe("createMovementRecorder", () => {
  it("records a takeoff on the ground to airborne transition at flying speed", () => {
    const { rec, events } = setup();
    rec.evaluate(track(0, { onGround: true, gs: 15 }));
    rec.evaluate(track(10_000, { onGround: true, gs: 120 }));
    expect(events).toHaveLength(0);
    rec.evaluate(track(20_000, { onGround: false, alt: 800, gs: 160 }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "takeoff",
      trackId: "t1",
      icao24: "8a0f21",
      callsign: "GIA123",
      airportId: "WARR",
      at: 20_000,
    });
    expect(rec.stats).toEqual({ evaluated: 3, movementsDetected: 1 });
  });

  it("records a landing, then does not repeat it for the same touchdown", () => {
    const { rec, events } = setup();
    rec.evaluate(track(0, { onGround: false, alt: 1500, gs: 150 }));
    rec.evaluate(track(10_000, { onGround: false, alt: 300, gs: 140 }));
    rec.evaluate(track(20_000, { onGround: true, alt: 0, gs: 100 }));
    rec.evaluate(track(25_000, { onGround: true, alt: 0, gs: 40 }));
    expect(events.map((e) => e.type)).toEqual(["landing"]);
  });

  it("ignores surface vehicles", () => {
    const { rec, events } = setup();
    rec.evaluate(track(0, { targetType: "vehicle", onGround: true }));
    rec.evaluate(
      track(10_000, {
        targetType: "vehicle",
        onGround: false,
        alt: 900,
        gs: 200,
      }),
    );
    expect(events).toHaveLength(0);
    expect(rec.stats.evaluated).toBe(0);
  });

  it("ignores tracks without a position", () => {
    const { rec, events } = setup();
    rec.evaluate(track(0, { noPosition: true }));
    expect(events).toHaveLength(0);
    expect(rec.stats.evaluated).toBe(0);
  });

  it("forgets a dropped track so a reused id starts fresh", () => {
    const { rec, events } = setup();
    rec.evaluate(track(0, { onGround: true, gs: 15 }));
    rec.evaluate(track(5_000, { lifecycle: "dropped" }));
    // First sighting after the drop only sets the phase; no takeoff from stale state.
    rec.evaluate(track(300_000, { onGround: false, alt: 900, gs: 160 }));
    expect(events).toHaveLength(0);
  });

  it("forget() has the same effect as a drop", () => {
    const { rec, events } = setup();
    rec.evaluate(track(0, { onGround: true, gs: 15 }));
    rec.forget("t1");
    rec.evaluate(track(300_000, { onGround: false, alt: 900, gs: 160 }));
    expect(events).toHaveLength(0);
  });

  it("keeps tracks apart", () => {
    const { rec, events } = setup();
    rec.evaluate(track(0, { trackId: "a", onGround: true, gs: 15 }));
    rec.evaluate(track(0, { trackId: "b", onGround: true, gs: 15 }));
    rec.evaluate(
      track(20_000, { trackId: "a", onGround: false, alt: 800, gs: 160 }),
    );
    expect(events.map((e) => e.trackId)).toEqual(["a"]);
  });

  it("sweeps tracks silent past the TTL", () => {
    const { rec, events } = setup();
    // A non-zero base: updatedAt 0 would be treated as "missing" and replaced by now.
    const base = 1_000_000;
    rec.evaluate(track(base, { onGround: true, gs: 15 }));
    rec.sweep(base + 11 * 60_000);
    rec.evaluate(
      track(base + 12 * 60_000, { onGround: false, alt: 900, gs: 160 }),
    );
    expect(events).toHaveLength(0);
  });

  it("does not take off below flying speed (hysteresis)", () => {
    const { rec, events } = setup();
    rec.evaluate(track(0, { onGround: true, gs: 10 }));
    rec.evaluate(track(20_000, { onGround: false, alt: 800, gs: 40 }));
    expect(events).toHaveLength(0);
  });

  it("debounces a go-around into one movement", () => {
    const { rec, events } = setup();
    rec.evaluate(track(0, { onGround: true, gs: 15 }));
    rec.evaluate(track(10_000, { onGround: false, alt: 800, gs: 160 }));
    rec.evaluate(track(20_000, { onGround: true, alt: 0, gs: 120 }));
    rec.evaluate(track(30_000, { onGround: false, alt: 800, gs: 160 }));
    expect(events.map((e) => e.type)).toEqual(["takeoff"]);
  });
});

describe("toMovementIngestEvent", () => {
  const base: MovementEvent = {
    trackId: "t1",
    icao24: "8a0f21",
    callsign: "GIA123",
    airportId: "WARR",
    type: "takeoff",
    at: 1_000,
    lat: -7.38,
    lon: 112.78,
  };

  it("keeps the fields the movement table stores", () => {
    expect(toMovementIngestEvent(base)).toEqual({
      trackId: "t1",
      type: "takeoff",
      at: 1_000,
      airportId: "WARR",
      icao24: "8a0f21",
      callsign: "GIA123",
      lat: -7.38,
      lon: 112.78,
    });
  });

  it("turns null identity into absent fields", () => {
    const out = toMovementIngestEvent({
      ...base,
      icao24: null,
      callsign: null,
      airportId: undefined,
    });
    expect("icao24" in out).toBe(false);
    expect("callsign" in out).toBe(false);
    expect("airportId" in out).toBe(false);
  });
});
