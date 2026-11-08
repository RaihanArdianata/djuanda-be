import { describe, expect, it } from "bun:test";
import {
  applyEngineSettings,
  engineSettings,
  engineSettingsFromEnv,
  resolveEngineSettings,
} from "./engine-settings";

describe("engineSettingsFromEnv", () => {
  it("reads the env values and falls back for what is missing or not a number", () => {
    const s = engineSettingsFromEnv({
      ALERT_TWIN_RADIUS_M: "100",
      ALERT_TWIN_MAX_SPEED_DIFF_KT: "abc",
    });
    expect(s.twinRadiusM).toBe(100);
    expect(s.twinMaxSpeedDiffKt).toBe(15);
    expect(engineSettingsFromEnv({}).twinRadiusM).toBe(60);
  });

  it("keeps 0, which switches the position check of twins off", () => {
    expect(
      engineSettingsFromEnv({ ALERT_TWIN_RADIUS_M: "0" }).twinRadiusM,
    ).toBe(0);
  });
});

describe("resolveEngineSettings", () => {
  const base = {
    twinRadiusM: 60,
    twinMaxSpeedDiffKt: 15,
    staleGraceSeconds: 20,
    occupancyStickyMs: 5000,
    reopenWindowSeconds: 0,
  };

  it("lets the rule override the env values", () => {
    expect(
      resolveEngineSettings({ twinRadiusM: 90, staleGraceSeconds: 30 }, base),
    ).toEqual({
      twinRadiusM: 90,
      twinMaxSpeedDiffKt: 15,
      staleGraceSeconds: 30,
      occupancyStickyMs: 5000,
      reopenWindowSeconds: 0,
    });
  });

  it("reads the reopen window, which is off (0) unless the rule sets it", () => {
    expect(resolveEngineSettings(undefined, base).reopenWindowSeconds).toBe(0);
    expect(
      resolveEngineSettings({ reopenWindowSeconds: 120 }, base)
        .reopenWindowSeconds,
    ).toBe(120);
    expect(
      resolveEngineSettings({ reopenWindowSeconds: -5 }, base)
        .reopenWindowSeconds,
    ).toBe(0);
  });

  it("ignores what is not a number or is negative, and accepts 0", () => {
    const s = resolveEngineSettings(
      { twinRadiusM: -1, twinMaxSpeedDiffKt: "x", staleGraceSeconds: 0 },
      base,
    );
    expect(s.twinRadiusM).toBe(60);
    expect(s.twinMaxSpeedDiffKt).toBe(15);
    expect(s.staleGraceSeconds).toBe(0);
  });

  it("is the env values with no rule", () => {
    expect(resolveEngineSettings(undefined, base)).toEqual(base);
  });
});

describe("applyEngineSettings", () => {
  it("changes the live settings in place and goes back to the env values when the rule is gone", () => {
    const before = { ...engineSettings };
    applyEngineSettings({ staleGraceSeconds: 99, occupancyStickyMs: 1234 });
    expect(engineSettings.staleGraceSeconds).toBe(99);
    expect(engineSettings.occupancyStickyMs).toBe(1234);
    applyEngineSettings(undefined);
    expect(engineSettings).toEqual(before);
  });
});
