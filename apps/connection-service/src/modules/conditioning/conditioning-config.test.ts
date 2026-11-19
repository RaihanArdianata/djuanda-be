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
      maxAirJumpKt: 1000,
      headingMinMoveM: 10,
    });
    expect(c.mlat.enabled).toBe(true);
    expect(c.mlat.options).toMatchObject({
      minConfidence: 0.4,
      unreliableThreshold: 3,
      recoveryThreshold: 3,
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
      expect(
        conditioningConfigFromEnv({ MLAT_VALIDATION_ENABLED: v }).mlat.enabled,
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
      MLAT_MIN_CONFIDENCE: "0.5",
      MLAT_UNRELIABLE_THRESHOLD: "4",
      MLAT_RECOVERY_THRESHOLD: "2",
      MLAT_MAX_STALE_MS: "8000",
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
    expect(c.mlat.options).toMatchObject({
      minConfidence: 0.5,
      unreliableThreshold: 4,
      recoveryThreshold: 2,
      maxStaleMs: 8000,
    });
  });

  it("falls back to the default, with a warning, for a value it cannot use", () => {
    const c = conditioningConfigFromEnv({
      GHOST_RADIUS_M: "abc",
      GHOST_MIN_REPORTS: "2.5",
      STABILIZER_MOVE_RADIUS_M: "0",
      STABILIZER_STAND_KT: "-3",
      MLAT_MIN_CONFIDENCE: "2.0",
      MLAT_UNRELIABLE_THRESHOLD: "0",
    });
    expect(c.ghost.options.radiusM).toBe(40);
    expect(c.ghost.options.minReports).toBe(3);
    expect(c.stabilizer.options.moveRadiusM).toBe(3);
    expect(c.stabilizer.options.standKt).toBe(6);
    expect(c.mlat.options.minConfidence).toBe(0.4);
    expect(c.mlat.options.unreliableThreshold).toBe(3);
    expect(c.warnings).toHaveLength(6);
  });
});

describe("createConditioning", () => {
  it("holds a ghost back and stabilizes what it lets through", () => {
    const c = clock();
    const cfg = conditioningConfigFromEnv({});
    cfg.ghost.options.now = c.now;
    cfg.stabilizer.options.now = c.now;
    cfg.mlat.options.now = c.now;
    const cond = createConditioning(cfg);

    cond.admit(
      track({
        trackId: "sjy",
        icao24: "8a06b3",
        north: 0,
        east: 0,
        groundSpeed: 10,
      }),
    );
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

  it("does nothing when all stages are off", () => {
    const cfg = conditioningConfigFromEnv({
      GHOST_FILTER_ENABLED: "false",
      TRACK_STABILIZER_ENABLED: "false",
      MLAT_VALIDATION_ENABLED: "false",
    });
    const cond = createConditioning(cfg);
    const e = track({ trackId: "echo", icao24: "r1-1-278" });
    expect(cond.admit(e).event).toBe(e);
    expect(cond.stabilize(e)).toBe(e);
    expect(cond.stats()).toEqual({ ghost: null, stabilizer: null, mlat: null });
  });

  it("turns a retraction into a dropped event with a reason", () => {
    const c = clock();
    // Target tanpa identitas ditampilkan (bawaan aplikasi menyembunyikannya), supaya penarikan gema yang sempat tampil teruji.
    const cfg = conditioningConfigFromEnv({
      GHOST_MIN_REPORTS: "1",
      GHOST_HIDE_UNIDENTIFIED: "false",
    });
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

describe("GHOST_ESTABLISHED_REPORTS", () => {
  it("defaults to 10", () => {
    expect(conditioningConfigFromEnv({}).ghost.options.establishedReports).toBe(
      10,
    );
  });

  it("takes a whole number, and 0 switches the rule off", () => {
    expect(
      conditioningConfigFromEnv({ GHOST_ESTABLISHED_REPORTS: "25" }).ghost
        .options.establishedReports,
    ).toBe(25);
    expect(
      conditioningConfigFromEnv({ GHOST_ESTABLISHED_REPORTS: "0" }).ghost
        .options.establishedReports,
    ).toBe(0);
  });

  it("warns and keeps the default for a value it cannot use", () => {
    for (const bad of ["-1", "2.5", "abc"]) {
      const cfg = conditioningConfigFromEnv({ GHOST_ESTABLISHED_REPORTS: bad });
      expect(cfg.ghost.options.establishedReports).toBe(10);
      expect(
        cfg.warnings.some((w) => w.includes("GHOST_ESTABLISHED_REPORTS")),
      ).toBe(true);
    }
  });
});

describe("GHOST_HIDE_UNIDENTIFIED", () => {
  it("is on by default", () => {
    expect(conditioningConfigFromEnv({}).ghost.options.hideUnidentified).toBe(
      true,
    );
  });

  it("is switched off by false, 0, off or no", () => {
    for (const v of ["false", "0", "off", "no", " FALSE "]) {
      expect(
        conditioningConfigFromEnv({ GHOST_HIDE_UNIDENTIFIED: v }).ghost.options
          .hideUnidentified,
      ).toBe(false);
    }
  });
});
