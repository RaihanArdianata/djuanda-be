import { describe, expect, it } from "bun:test";
import type { CurrentTrack } from "@aeroswarm/core/types";
import { createTrackState } from "@aeroswarm/live-server";
import { createMovementPhaseStore } from "./movement-phase";

const track = (over: Partial<CurrentTrack> = {}): CurrentTrack =>
  ({
    trackId: "t1",
    source: "FUSED",
    icao24: "8a0522",
    callsign: "BTK6391",
    squawk: null,
    lat: -7.38,
    lon: 112.78,
    altitudeFt: 0,
    groundSpeedKt: 10,
    headingDeg: 90,
    verticalRateFpm: 0,
    confidence: 1,
    lastSeenAt: 1,
    status: "active",
    ...over,
  }) as CurrentTrack;

describe("movement phase store", () => {
  it("leaves a track alone until it has taken off or landed", () => {
    const store = createMovementPhaseStore();
    const t = track();
    expect(store.attach(t)).toBe(t);
  });

  it("marks a takeoff as DEPARTURE even without any flight plan", () => {
    const store = createMovementPhaseStore();
    store.set("t1", "takeoff");
    const out = store.attach(track());
    expect(out.flightPlan).toEqual({
      id: "movement:t1",
      status: "departed",
      phase: "DEPARTURE",
    });
  });

  it("marks a landing as ARRIVAL even without any flight plan", () => {
    const store = createMovementPhaseStore();
    store.set("t1", "landing");
    expect(store.attach(track()).flightPlan).toMatchObject({
      status: "arrived",
      phase: "ARRIVAL",
    });
  });

  it("overrides the phase of a flight plan but keeps the rest of it", () => {
    const store = createMovementPhaseStore();
    store.set("t1", "takeoff");
    const withPlan = track({
      flightPlan: {
        id: "BTK6391|WARR|WIII|20261101",
        status: "filed",
        phase: "ARRIVAL",
        adep: "WARR",
        ades: "WIII",
      },
    });
    expect(store.attach(withPlan).flightPlan).toEqual({
      id: "BTK6391|WARR|WIII|20261101",
      status: "filed",
      phase: "DEPARTURE",
      adep: "WARR",
      ades: "WIII",
    });
  });

  it("returns the same track when the phase already matches", () => {
    const store = createMovementPhaseStore();
    store.set("t1", "takeoff");
    const once = store.attach(track());
    expect(store.attach(once)).toBe(once);
  });

  it("follows the latest movement and forgets removed tracks", () => {
    const store = createMovementPhaseStore();
    store.set("t1", "takeoff");
    store.set("t1", "landing");
    expect(store.get("t1")).toBe("landing");
    store.forget("t1");
    expect(store.size).toBe(0);
    const t = track();
    expect(store.attach(t)).toBe(t);
  });
});

describe("with the live picture", () => {
  it("pushes the new phase to subscribers as soon as the movement is detected", () => {
    const store = createMovementPhaseStore();
    const state = createTrackState({
      staleAfterMs: 60_000,
      lostAfterMs: 120_000,
      removeAfterMs: 300_000,
      attachFlightPlan: store.attach,
    });
    const updates: CurrentTrack[] = [];
    state.on("update", (t: CurrentTrack) => {
      updates.push(t);
    });

    const now = Date.now();
    state.ingest({
      trackId: "t1",
      sources: ["asterix-udp"],
      airportId: "WARR",
      identity: { icao24: "8a0522", callsign: "BTK6391" },
      protocol: "asterix-cat021",
      position: { lat: -7.38, lon: 112.78, alt: 0, onGround: true },
      velocity: { groundSpeed: 5, heading: 90 },
      confidence: {
        overall: 0.9,
        position: 0.9,
        identity: 0.9,
        velocity: 0.9,
        sourceAgreement: 1,
        spoofRisk: 0,
      },
      fusedAt: now,
      updatedAt: now,
      lifecycle: "updated",
    });
    expect(state.get("t1")?.flightPlan).toBeUndefined();

    store.set("t1", "takeoff");
    state.refreshFlightPlans((t: CurrentTrack) => t.trackId === "t1");

    expect(state.get("t1")?.flightPlan?.phase).toBe("DEPARTURE");
    expect(updates.at(-1)?.flightPlan?.phase).toBe("DEPARTURE");
  });
});
