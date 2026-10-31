import { describe, expect, it } from "bun:test";
import {
  DEFAULT_AIRBORNE_PRIORITY,
  DEFAULT_SURFACE_PRIORITY,
  fusionConfigFromEnv,
} from "./fusion-config";

describe("fusionConfigFromEnv", () => {
  it("is on by default, with MLAT first on the ground and radar first in the air", () => {
    const c = fusionConfigFromEnv({});
    expect(c.enabled).toBe(true);
    expect(c.warnings).toEqual([]);
    expect(c.options.surfacePriority).toEqual(DEFAULT_SURFACE_PRIORITY);
    expect(c.options.airbornePriority).toEqual(DEFAULT_AIRBORNE_PRIORITY);
    expect(c.options.surfacePriority[0]).toBe("asterix-cat010");
    expect(c.options.airbornePriority[0]).toBe("asterix-cat062");
    expect(c.options).toMatchObject({
      maxSourceAgeMs: 5_000,
      forgetAfterMs: 600_000,
      spatial: false,
      matchRadiusM: 150,
      matchMaxSkewMs: 3_000,
      disagreeM: 300,
    });
  });

  it("can be switched off", () => {
    for (const v of ["false", "0", "off", "NO", " False "]) {
      expect(fusionConfigFromEnv({ FUSION_ENABLED: v }).enabled).toBe(false);
    }
    expect(fusionConfigFromEnv({ FUSION_ENABLED: "true" }).enabled).toBe(true);
  });

  it("reads priority lists, trimming blanks", () => {
    const c = fusionConfigFromEnv({
      FUSION_SURFACE_PRIORITY: " mlat-udp , asterix-cat010,, ",
      FUSION_AIRBORNE_PRIORITY: "radar-main",
    });
    expect(c.options.surfacePriority).toEqual(["mlat-udp", "asterix-cat010"]);
    expect(c.options.airbornePriority).toEqual(["radar-main"]);
  });

  it("reads numbers and the spatial switch", () => {
    const c = fusionConfigFromEnv({
      FUSION_SPATIAL: "true",
      FUSION_MATCH_RADIUS_M: "80",
      FUSION_MATCH_MAX_SKEW_MS: "1500",
      FUSION_MAX_SOURCE_AGE_MS: "2000",
      FUSION_DISAGREE_M: "500",
      FUSION_FORGET_AFTER_MS: "60000",
    });
    expect(c.options).toMatchObject({
      spatial: true,
      matchRadiusM: 80,
      matchMaxSkewMs: 1500,
      maxSourceAgeMs: 2000,
      disagreeM: 500,
      forgetAfterMs: 60000,
    });
    expect(c.warnings).toEqual([]);
  });

  it("falls back to the default and warns for an unusable number", () => {
    const c = fusionConfigFromEnv({
      FUSION_MATCH_RADIUS_M: "abc",
      FUSION_DISAGREE_M: "-5",
      FUSION_MAX_SOURCE_AGE_MS: "0",
    });
    expect(c.options.matchRadiusM).toBe(150);
    expect(c.options.disagreeM).toBe(300);
    expect(c.options.maxSourceAgeMs).toBe(5_000);
    expect(c.warnings).toHaveLength(3);
    for (const key of [
      "FUSION_MATCH_RADIUS_M",
      "FUSION_DISAGREE_M",
      "FUSION_MAX_SOURCE_AGE_MS",
    ]) {
      expect(c.warnings.some((w) => w.includes(key))).toBe(true);
    }
  });
});
