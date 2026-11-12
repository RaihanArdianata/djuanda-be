import { describe, expect, it } from "bun:test";
import { createConditioning } from "./conditioning";
import { conditioningConfigFromEnv } from "./conditioning-config";
import { clock, track } from "./test-support";

describe("conditioningConfigFromEnv", () => {
  it("is on by default with the standard values", () => {
    const c = conditioningConfigFromEnv({});
    expect(c.ghost.enabled).toBe(true);
    expect(c.ghost.options).toMatchObject({
      radiusM: 40,
      minReports: 3,
      maxAgeMs: 2000,
    });
    expect(c.stabilizer.enabled).toBe(true);
    expect(c.stabilizer.options).toMatchObject({
      standKt: 6,
      radiusM: 15,
      moveRadiusM: 3,
      maxJumpKt: 80,
      headingMinMoveM: 10,
    });
    expect(c.warnings).toEqual([]);
  });

  it("is switched off per stage", () => {
    for (const v of ["false", "0", "off", "no", " FALSE "]) {
      expect(
        conditioningConfigFromEnv({ GHOST_FILTER_ENABLED: v }).ghost.enabled,
      ).toBe(false);
      expect(
        conditioningConfigFromEnv({ TRACK_STABILIZER_ENABLED: v }).stabilizer
          .enabled,
      ).toBe(false);
    }
    expect(
      conditioningConfigFromEnv({ GHOST_FILTER_ENABLED: "false" }).stabilizer
        .enabled,
    ).toBe(true);
  });

  it("reads numbers", () => {
    const c = conditioningConfigFromEnv({
      GHOST_RADIUS_M: "25",
      GHOST_MIN_REPORTS: "5",
      GHOST_MAX_AGE_MS: "1500",
      STABILIZER_STAND_KT: "8",
      STABILIZER_RADIUS_M: "30",
      STABILIZER_MOVE_RADIUS_M: "5",
    });
    expect(c.ghost.options).toMatchObject({
      radiusM: 25,
      minReports: 5,
      maxAgeMs: 1500,
    });
    expect(c.stabilizer.options).toMatchObject({
      standKt: 8,
      radiusM: 30,
      moveRadiusM: 5,
    });
  });

  it("falls back to the default, with a warning, for a value it cannot use", () => {
    const c = conditioningConfigFromEnv({
      GHOST_RADIUS_M: "abc",
      GHOST_MIN_REPORTS: "2.5",
      STABILIZER_MOVE_RADIUS_M: "0",
      STABILIZER_STAND_KT: "-3",
    });
    expect(c.ghost.options.radiusM).toBe(40);
    expect(c.ghost.options.minReports).toBe(3);
    expect(c.stabilizer.options.moveRadiusM).toBe(3);
    expect(c.stabilizer.options.standKt).toBe(6);
    expect(c.warnings).toHaveLength(4);
  });
});

describe("createConditioning", () => {
  it("holds a ghost back and stabilizes what it lets through", () => {
    const c = clock();
    const cfg = conditioningConfigFromEnv({});
    cfg.ghost.options.now = c.now;
    cfg.stabilizer.options.now = c.now;
    const cond = createConditioning(cfg);

    cond.admit(track({ trackId: "sjy", icao24: "8a06b3", north: 0, east: 0 }));
    expect(
      cond.admit(
        track({ trackId: "echo", icao24: "r1-1-278", north: 6, east: 0 }),
      ).event,
    ).toBeNull();

    const real = track({
      trackId: "sjy",
      icao24: "8a06b3",
      north: 3,
      east: 2,
      groundSpeed: 1,
      heading: 200,
    });
    const admitted = cond.admit(real).event;
    expect(admitted).not.toBeNull();
    const out = cond.stabilize(admitted as typeof real);
    expect(out.trackId).toBe("sjy");
  });

  it("does nothing when both stages are off", () => {
    const cfg = conditioningConfigFromEnv({
      GHOST_FILTER_ENABLED: "false",
      TRACK_STABILIZER_ENABLED: "false",
    });
    const cond = createConditioning(cfg);
    const e = track({ trackId: "echo", icao24: "r1-1-278" });
    expect(cond.admit(e).event).toBe(e);
    expect(cond.stabilize(e)).toBe(e);
    expect(cond.stats()).toEqual({ ghost: null, stabilizer: null });
  });

  it("turns a retraction into a dropped event with a reason", () => {
    const c = clock();
    const cfg = conditioningConfigFromEnv({ GHOST_MIN_REPORTS: "1" });
    cfg.ghost.options.now = c.now;
    const cond = createConditioning(cfg);
    expect(
      cond.admit(track({ trackId: "echo", icao24: "r1-1-278", north: 300 }))
        .event,
    ).not.toBeNull();
    cond.admit(track({ trackId: "sjy", icao24: "8a06b3", north: 0 }));
    const result = cond.admit(
      track({ trackId: "echo", icao24: "r1-1-278", north: 5 }),
    );
    expect(result.event?.lifecycle).toBe("dropped");
    expect(result.reason).toContain("bayangan");
  });
});
