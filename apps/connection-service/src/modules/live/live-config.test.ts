import { describe, expect, it } from "bun:test";
import { liveConfigFromEnv } from "./live-config";

describe("liveConfigFromEnv", () => {
  it("leaves everything to the package defaults when nothing is set", () => {
    const c = liveConfigFromEnv({});
    expect(c).toEqual({
      staleAfterMs: undefined,
      lostAfterMs: undefined,
      removeAfterMs: undefined,
      interestBbox: undefined,
      interestLookaheadMin: undefined,
      exit: { enabled: true },
      defaultUpdateHz: undefined,
      heartbeatMs: undefined,
      sweepMs: 5000,
      warnings: [],
    });
  });

  it("reads numeric settings", () => {
    const c = liveConfigFromEnv({
      STALE_AFTER_MS: "10000",
      LOST_AFTER_MS: "60000",
      TRACK_REMOVE_AFTER_MS: "900000",
      WS_DEFAULT_UPDATE_HZ: "5",
      WS_HEARTBEAT_MS: "10000",
      TRACK_SWEEP_MS: "1000",
      INTEREST_LOOKAHEAD_MIN: "30",
    });
    expect(c).toMatchObject({
      staleAfterMs: 10000,
      lostAfterMs: 60000,
      removeAfterMs: 900000,
      defaultUpdateHz: 5,
      heartbeatMs: 10000,
      sweepMs: 1000,
      interestLookaheadMin: 30,
      warnings: [],
    });
  });

  it("lets TRACK_REMOVE_AFTER_MS be 0 (never remove) but no other setting", () => {
    expect(
      liveConfigFromEnv({ TRACK_REMOVE_AFTER_MS: "0" }).removeAfterMs,
    ).toBe(0);
    const c = liveConfigFromEnv({
      STALE_AFTER_MS: "0",
      WS_DEFAULT_UPDATE_HZ: "0",
    });
    expect(c.staleAfterMs).toBeUndefined();
    expect(c.defaultUpdateHz).toBeUndefined();
    expect(c.warnings).toHaveLength(2);
  });

  it("warns on junk and negative values and keeps the default", () => {
    const c = liveConfigFromEnv({ LOST_AFTER_MS: "abc", TRACK_SWEEP_MS: "-5" });
    expect(c.lostAfterMs).toBeUndefined();
    expect(c.sweepMs).toBe(5000);
    expect(c.warnings).toHaveLength(2);
  });

  it("resets both thresholds when stale is not smaller than lost", () => {
    const c = liveConfigFromEnv({
      STALE_AFTER_MS: "90000",
      LOST_AFTER_MS: "15000",
    });
    expect(c.staleAfterMs).toBeUndefined();
    expect(c.lostAfterMs).toBeUndefined();
    expect(
      c.warnings.some((w) => w.includes("STALE_AFTER_MS must be smaller")),
    ).toBe(true);
  });

  it("removing aircraft that left the interest box is on by default", () => {
    expect(liveConfigFromEnv({}).exit).toEqual({ enabled: true });
    expect(
      liveConfigFromEnv({ INTEREST_BBOX: "112,-8,113,-7" }).warnings,
    ).toEqual([]);
  });

  it("reads the exit settings, and lets the margin be 0", () => {
    const c = liveConfigFromEnv({
      INTEREST_BBOX: "112,-8,113,-7",
      EXIT_MARGIN_M: "0",
      EXIT_CONFIRM_FIXES: "1",
      EXIT_SUPPRESS_MS: "60000",
    });
    expect(c.exit).toEqual({
      enabled: true,
      marginM: 0,
      confirmFixes: 1,
      suppressMs: 60000,
    });
    expect(c.warnings).toEqual([]);
  });

  it("switches off with false, 0, off or no", () => {
    for (const v of ["false", "0", "off", "NO", " False "]) {
      expect(
        liveConfigFromEnv({
          EXIT_REMOVE_ENABLED: v,
          INTEREST_BBOX: "112,-8,113,-7",
        }).exit.enabled,
      ).toBe(false);
    }
  });

  it("confirmFixes is a whole number of at least 1", () => {
    expect(
      liveConfigFromEnv({ EXIT_CONFIRM_FIXES: "2.9" }).exit.confirmFixes,
    ).toBe(2);
    expect(
      liveConfigFromEnv({ EXIT_CONFIRM_FIXES: "0" }).exit.confirmFixes,
    ).toBeUndefined();
    expect(
      liveConfigFromEnv({ EXIT_CONFIRM_FIXES: "0" }).warnings,
    ).toHaveLength(1);
  });

  it("warns on a junk value and keeps the default", () => {
    const c = liveConfigFromEnv({
      EXIT_MARGIN_M: "abc",
      EXIT_SUPPRESS_MS: "-5",
    });
    expect(c.exit.marginM).toBeUndefined();
    expect(c.exit.suppressMs).toBeUndefined();
    expect(c.warnings).toHaveLength(2);
  });

  it("warns when exit is asked for explicitly but there is no interest box", () => {
    const c = liveConfigFromEnv({ EXIT_REMOVE_ENABLED: "true" });
    expect(c.warnings).toHaveLength(1);
    expect(c.warnings[0]).toContain("INTEREST_BBOX");
    // and stays quiet when it is simply left at its default
    expect(liveConfigFromEnv({}).warnings).toEqual([]);
  });

  it("parses INTEREST_BBOX and rejects malformed ones", () => {
    expect(
      liveConfigFromEnv({ INTEREST_BBOX: "112,-8,113,-7" }).interestBbox,
    ).toEqual([112, -8, 113, -7]);
    for (const bad of [
      "1,2,3",
      "a,b,c,d",
      "113,-8,112,-7",
      "112,-8,113,-95",
      "200,-8,201,-7",
    ]) {
      const c = liveConfigFromEnv({ INTEREST_BBOX: bad });
      expect(c.interestBbox).toBeUndefined();
      expect(c.warnings).toHaveLength(1);
    }
  });
});
