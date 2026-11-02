import { describe, expect, it } from "bun:test";
import {
  createPrimaryFeedGate,
  dedupeWindowFromEnv,
  icao24Of,
  isCoveredDuplicate,
  isFlightPlanShape,
} from "./primary-feed-gate";

const WINDOW = 20_000;

describe("primary feed gate", () => {
  it("drops secondary events for an aircraft the direct feed just saw", () => {
    const gate = createPrimaryFeedGate(WINDOW);
    gate.seen("8A0522", 1_000);
    expect(gate.shouldDrop("8a0522", 5_000)).toBe(true);
    expect(gate.stats()).toMatchObject({ dropped: 1, passed: 0, tracked: 1 });
  });

  it("passes events for aircraft the direct feed has not seen", () => {
    const gate = createPrimaryFeedGate(WINDOW);
    gate.seen("8a0522", 1_000);
    expect(gate.shouldDrop("8a081e", 2_000)).toBe(false);
  });

  it("falls back to the secondary feed once the direct feed goes quiet", () => {
    const gate = createPrimaryFeedGate(WINDOW);
    gate.seen("8a0522", 1_000);
    expect(gate.shouldDrop("8a0522", 1_000 + WINDOW)).toBe(true);
    expect(gate.shouldDrop("8a0522", 1_000 + WINDOW + 1)).toBe(false);
  });

  it("recovers coverage as soon as the direct feed sees the aircraft again", () => {
    const gate = createPrimaryFeedGate(WINDOW);
    gate.seen("8a0522", 0);
    expect(gate.shouldDrop("8a0522", 60_000)).toBe(false);
    gate.seen("8a0522", 61_000);
    expect(gate.shouldDrop("8a0522", 62_000)).toBe(true);
  });

  it("cannot match an event without an icao24, so it passes", () => {
    const gate = createPrimaryFeedGate(WINDOW);
    gate.seen("8a0522", 0);
    expect(gate.shouldDrop(undefined, 1)).toBe(false);
    expect(gate.shouldDrop(null, 1)).toBe(false);
    expect(gate.shouldDrop("  ", 1)).toBe(false);
  });

  it("forgets aircraft that have been silent for long", () => {
    const gate = createPrimaryFeedGate(WINDOW);
    gate.seen("8a0522", 0);
    gate.sweep(WINDOW * 4);
    expect(gate.stats().tracked).toBe(1);
    gate.sweep(WINDOW * 4 + 1);
    expect(gate.stats().tracked).toBe(0);
  });
});

describe("what counts as a duplicate", () => {
  const trackEvent = { trackId: "ast_x", identity: { icao24: "8a0522" } };
  const movementEvent = { trackId: "ast_x", type: "takeoff", icao24: "8a0522" };

  it("filters AeroSwarm track and movement events covered by the direct feed", () => {
    const gate = createPrimaryFeedGate(WINDOW);
    gate.seen("8a0522");
    expect(isCoveredDuplicate(gate, "track", trackEvent)).toBe(true);
    expect(isCoveredDuplicate(gate, "movement", movementEvent)).toBe(true);
  });

  it("never filters alerts, unknown shapes, or when there is no gate", () => {
    const gate = createPrimaryFeedGate(WINDOW);
    gate.seen("8a0522");
    expect(isCoveredDuplicate(gate, "alert", trackEvent)).toBe(false);
    expect(isCoveredDuplicate(gate, "unknown", trackEvent)).toBe(false);
    expect(isCoveredDuplicate(undefined, "track", trackEvent)).toBe(false);
  });

  it("reads icao24 from either event shape", () => {
    expect(icao24Of(trackEvent)).toBe("8a0522");
    expect(icao24Of(movementEvent)).toBe("8a0522");
    expect(icao24Of({ trackId: "x" })).toBeUndefined();
    expect(icao24Of(null)).toBeUndefined();
  });

  it("recognises AFTN events that AeroSwarm also writes to the ingest topic", () => {
    expect(
      isFlightPlanShape({ messageId: "m1", message: { type: "FPL" } }),
    ).toBe(true);
    expect(isFlightPlanShape(trackEvent)).toBe(false);
    expect(isFlightPlanShape("text")).toBe(false);
  });
});

describe("dedupe window", () => {
  it("defaults to 20 seconds and honours a valid override", () => {
    expect(dedupeWindowFromEnv({})).toBe(20_000);
    expect(dedupeWindowFromEnv({ INGEST_DEDUPE_WINDOW_MS: "45000" })).toBe(
      45_000,
    );
    expect(dedupeWindowFromEnv({ INGEST_DEDUPE_WINDOW_MS: "abc" })).toBe(
      20_000,
    );
    expect(dedupeWindowFromEnv({ INGEST_DEDUPE_WINDOW_MS: "-5" })).toBe(20_000);
  });
});
