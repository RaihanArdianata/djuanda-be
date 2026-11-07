import { describe, expect, it } from "bun:test";
import { createStoreFilter, type StoreCandidate } from "./store-filter";

const update = (
  over: Partial<StoreCandidate> & { at?: number } = {},
): StoreCandidate => {
  const { at, ...rest } = over;
  return {
    trackId: "t1",
    fusedAt: at ?? 0,
    lifecycle: "updated",
    identity: { callsign: "BTK7158", targetType: "aircraft" },
    position: { onGround: true },
    ...rest,
  };
};

describe("createStoreFilter", () => {
  it("stores the first update of a track, then at most one per interval", () => {
    const f = createStoreFilter({ minIntervalMs: 1000 });
    expect(f.shouldStore(update({ at: 0 }))).toBe(true);
    expect(f.shouldStore(update({ at: 200 }))).toBe(false);
    expect(f.shouldStore(update({ at: 900 }))).toBe(false);
    expect(f.shouldStore(update({ at: 1000 }))).toBe(true);
    expect(f.shouldStore(update({ at: 1500 }))).toBe(false);
    expect(f.shouldStore(update({ at: 2000 }))).toBe(true);
  });

  it("counts the interval from the last row stored, not from the last update seen", () => {
    const f = createStoreFilter({ minIntervalMs: 1000 });
    f.shouldStore(update({ at: 0 }));
    for (let at = 100; at < 1000; at += 100)
      expect(f.shouldStore(update({ at }))).toBe(false);
    expect(f.shouldStore(update({ at: 1000 }))).toBe(true);
  });

  it("keeps tracks apart", () => {
    const f = createStoreFilter({ minIntervalMs: 1000 });
    expect(f.shouldStore(update({ trackId: "a", at: 0 }))).toBe(true);
    expect(f.shouldStore(update({ trackId: "b", at: 10 }))).toBe(true);
    expect(f.shouldStore(update({ trackId: "a", at: 20 }))).toBe(false);
  });

  it("stores a change that matters at once: lifecycle, callsign, type, ground state", () => {
    const f = createStoreFilter({ minIntervalMs: 1000 });
    f.shouldStore(update({ at: 0 }));
    expect(f.shouldStore(update({ at: 10, lifecycle: "merged" }))).toBe(true);
    expect(
      f.shouldStore(
        update({
          at: 20,
          lifecycle: "merged",
          identity: { callsign: "BTK7159", targetType: "aircraft" },
        }),
      ),
    ).toBe(true);
    expect(
      f.shouldStore(
        update({
          at: 30,
          lifecycle: "merged",
          identity: { callsign: "BTK7159", targetType: "vehicle" },
        }),
      ),
    ).toBe(true);
    expect(
      f.shouldStore(
        update({
          at: 40,
          lifecycle: "merged",
          identity: { callsign: "BTK7159", targetType: "vehicle" },
          position: { onGround: false },
        }),
      ),
    ).toBe(true);
    // and then the same again is thinned
    expect(
      f.shouldStore(
        update({
          at: 50,
          lifecycle: "merged",
          identity: { callsign: "BTK7159", targetType: "vehicle" },
          position: { onGround: false },
        }),
      ),
    ).toBe(false);
  });

  it("does not take a missing field for a change", () => {
    const f = createStoreFilter({ minIntervalMs: 1000 });
    f.shouldStore(update({ at: 0 }));
    // a sensor that carries no callsign or ground bit must not make every update look new
    expect(
      f.shouldStore({ trackId: "t1", fusedAt: 10, lifecycle: "updated" }),
    ).toBe(false);
  });

  it("always stores a dropped track, and forgets it", () => {
    const f = createStoreFilter({ minIntervalMs: 1000 });
    f.shouldStore(update({ at: 0 }));
    expect(f.size).toBe(1);
    expect(f.shouldStore(update({ at: 10, lifecycle: "dropped" }))).toBe(true);
    expect(f.size).toBe(0);
    // the same track coming back is new again
    expect(f.shouldStore(update({ at: 20 }))).toBe(true);
  });

  it("with the interval at 0 stores everything", () => {
    const f = createStoreFilter({ minIntervalMs: 0 });
    for (let at = 0; at < 5; at++)
      expect(f.shouldStore(update({ at }))).toBe(true);
    expect(f.size).toBe(0);
  });

  it("a clock that steps back does not count as an interval having passed", () => {
    const f = createStoreFilter({ minIntervalMs: 1000 });
    f.shouldStore(update({ at: 5000 }));
    expect(f.shouldStore(update({ at: 1000 }))).toBe(false);
  });
});
