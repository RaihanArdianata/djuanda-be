import { describe, expect, test } from "bun:test";
import { createMlatValidator, isAircraft, isMlatTrack } from "./mlat-validator";
import { clock, offset, track } from "./test-support";

describe("mlat-validator helpers", () => {
  test("isMlatTrack identifies MLAT protocols and sources", () => {
    expect(
      isMlatTrack(track({ trackId: "1", protocol: "asterix-cat020" })),
    ).toBe(true);
    expect(
      isMlatTrack(track({ trackId: "2", protocol: "asterix-cat010" })),
    ).toBe(true);
    expect(
      isMlatTrack(track({ trackId: "3", protocol: "asterix-cat011" })),
    ).toBe(true);
    expect(
      isMlatTrack(track({ trackId: "4", protocol: "asterix-cat021" })),
    ).toBe(false);
    expect(
      isMlatTrack(track({ trackId: "5", protocol: "asterix-cat048" })),
    ).toBe(false);

    // Named source mlat
    const customSource = track({ trackId: "6", protocol: "asterix-cat021" });
    customSource.sources = ["mlat-tcp"];
    expect(isMlatTrack(customSource)).toBe(true);
  });

  test("isAircraft distinguishes aircraft from ground vehicles", () => {
    expect(isAircraft(track({ trackId: "GA123", icao24: "71C123" }))).toBe(
      true,
    );

    const vehicleByPrefix = track({ trackId: "v1-1-1", icao24: "v1-1-1" });
    expect(isAircraft(vehicleByPrefix)).toBe(false);

    const vehicleByType = track({ trackId: "v2" });
    vehicleByType.identity.targetType = "vehicle";
    expect(isAircraft(vehicleByType)).toBe(false);

    const vehicleByFleet = track({ trackId: "v3" });
    vehicleByFleet.identity.vehicleFleet = 1;
    expect(isAircraft(vehicleByFleet)).toBe(false);
  });
});

describe("mlat-validator altitude ceiling", () => {
  test("holds and then retracts aircraft above max altitude", () => {
    const v = createMlatValidator({ maxAltitudeFt: 5000, now: clock().now });
    const high = track({ trackId: "GA999", icao24: "71C999" });
    high.position = { ...offset(0, 0), alt: 12000, onGround: false };
    expect(v.check(high)).toEqual({
      action: "hold",
      reason: "ketinggian (12000 ft) melebihi batas cakupan MLAT (5000 ft)",
    });
    expect(v.check(high)).toEqual({
      action: "hold",
      reason: "ketinggian (12000 ft) melebihi batas cakupan MLAT (5000 ft)",
    });
    // pesawat sempat tampil (valid), lalu naik di atas batas → retract
    const v2 = createMlatValidator({ maxAltitudeFt: 5000, now: clock().now });
    const rising = track({ trackId: "GA996", icao24: "71C996" });
    rising.position = { ...offset(0, 0), alt: 3000, onGround: false };
    expect(v2.check(rising)).toEqual({ action: "pass" });
    rising.position = { ...offset(0, 0), alt: 12000, onGround: false };
    expect(v2.check(rising)).toEqual({
      action: "hold",
      reason: "ketinggian (12000 ft) melebihi batas cakupan MLAT (5000 ft)",
    });
    expect(v2.check(rising)).toEqual({
      action: "hold",
      reason: "ketinggian (12000 ft) melebihi batas cakupan MLAT (5000 ft)",
    });
    expect(v2.check(rising).action).toBe("retract");

    // pesawat di bawah batas tetap pass
    const ok = track({ trackId: "GA998", icao24: "71C998" });
    ok.position = { ...offset(0, 0), alt: 3000, onGround: false };
    expect(v.check(ok)).toEqual({ action: "pass" });
  });

  test("maxAltitudeFt=0 disables the ceiling", () => {
    const v = createMlatValidator({ maxAltitudeFt: 0, now: clock().now });
    const high = track({ trackId: "GA997", icao24: "71C997" });
    high.position = { ...offset(0, 0), alt: 12000, onGround: false };
    expect(v.check(high)).toEqual({ action: "pass" });
  });
});

describe("mlat-validator evaluation logic", () => {
  test("passes non-MLAT tracks without inspection", () => {
    const v = createMlatValidator();
    const adsb = track({
      trackId: "adsb1",
      protocol: "asterix-cat021",
      groundSpeed: 999,
    });
    expect(v.check(adsb)).toEqual({ action: "pass" });
    expect(v.stats().inspected).toBe(0);
  });

  test("passes ground vehicles without inspection", () => {
    const v = createMlatValidator();
    const car = track({
      trackId: "v1-1-1",
      icao24: "v1-1-1",
      groundSpeed: 150,
    });
    expect(v.check(car)).toEqual({ action: "pass" });
    expect(v.stats().inspected).toBe(0);
  });

  test("passes valid MLAT aircraft reports", () => {
    const v = createMlatValidator();
    const plane = track({
      trackId: "BTK101",
      protocol: "asterix-cat020",
      onGround: true,
      groundSpeed: 15,
    });
    expect(v.check(plane)).toEqual({ action: "pass" });
    expect(v.stats().inspected).toBe(1);
    expect(v.stats().unreliableReports).toBe(0);
  });

  test("detects ground speed anomaly and retracts after threshold", () => {
    const c = clock(1_000_000);
    const v = createMlatValidator({ now: c.now, unreliableThreshold: 3 });
    const normal = track({
      trackId: "GIA202",
      protocol: "asterix-cat020",
      onGround: true,
      groundSpeed: 20,
    });
    // First: valid report, shown
    expect(v.check(normal)).toEqual({ action: "pass" });

    // Anomalous speed report 1 (> 100 kt on ground)
    c.advance(1000);
    const bad1 = track({
      trackId: "GIA202",
      protocol: "asterix-cat020",
      onGround: true,
      groundSpeed: 180,
    });
    expect(v.check(bad1).action).toBe("hold");

    // Anomalous speed report 2
    c.advance(1000);
    expect(v.check(bad1).action).toBe("hold");

    // Anomalous speed report 3: reaches unreliableThreshold, triggers retract
    c.advance(1000);
    const verdict3 = v.check(bad1);
    expect(verdict3.action).toBe("retract");
    if (verdict3.action === "retract") {
      expect(verdict3.reason).toContain("kecepatan darat");
    }
    expect(v.stats().retractedTracks).toBe(1);

    // Subsequent bad reports continue to be held
    c.advance(1000);
    expect(v.check(bad1).action).toBe("hold");
  });

  test("detects position teleportation / jump", () => {
    const c = clock(1_000_000);
    const v = createMlatValidator({ now: c.now, maxGroundJumpSpeedKt: 150 });
    // First fix at (0, 0)
    const fix1 = track({
      trackId: "LNI303",
      protocol: "asterix-cat020",
      onGround: true,
      north: 0,
      east: 0,
    });
    expect(v.check(fix1)).toEqual({ action: "pass" });

    // Fix 2: 1 second later, 1000 meters away (1000 m / 1s = 1000 m/s ~ 1943 kt >> 150 kt)
    c.advance(1000);
    const fix2 = track({
      trackId: "LNI303",
      protocol: "asterix-cat020",
      onGround: true,
      north: 1000,
      east: 0,
    });
    const verdict = v.check(fix2);
    expect(verdict.action).toBe("hold");
    if (verdict.action === "hold") {
      expect(verdict.reason).toContain("lonjakan posisi teleportasi");
    }
  });

  test("detects low confidence budget", () => {
    const v = createMlatValidator({ minConfidence: 0.5 });
    const lowConf = track({
      trackId: "SJY404",
      protocol: "asterix-cat020",
      onGround: true,
      groundSpeed: 10,
    });
    lowConf.confidence.overall = 0.25;
    const verdict = v.check(lowConf);
    expect(verdict.action).toBe("hold");
    if (verdict.action === "hold") {
      expect(verdict.reason).toContain("confidence");
    }
  });

  test("recovers track after recoveryThreshold consecutive valid reports", () => {
    const c = clock(1_000_000);
    const v = createMlatValidator({
      now: c.now,
      unreliableThreshold: 2,
      recoveryThreshold: 3,
    });
    const plane = track({
      trackId: "AWQ505",
      protocol: "asterix-cat020",
      onGround: true,
      groundSpeed: 15,
    });

    // Shown
    expect(v.check(plane)).toEqual({ action: "pass" });

    // 2 anomalies -> retracted
    const bad = track({
      trackId: "AWQ505",
      protocol: "asterix-cat020",
      onGround: true,
      groundSpeed: 250,
    });
    c.advance(1000);
    expect(v.check(bad).action).toBe("hold");
    c.advance(1000);
    expect(v.check(bad).action).toBe("retract");

    // Recovery streak 1 -> hold
    c.advance(1000);
    expect(v.check(plane).action).toBe("hold");
    // Recovery streak 2 -> hold
    c.advance(1000);
    expect(v.check(plane).action).toBe("hold");
    // Recovery streak 3 -> recovered, pass!
    c.advance(1000);
    expect(v.check(plane)).toEqual({ action: "pass" });
    expect(v.stats().recoveredTracks).toBe(1);
  });

  test("sweep detects stale tracks and cleans up forgotten ones", () => {
    const c = clock(1_000_000);
    const v = createMlatValidator({
      now: c.now,
      maxStaleMs: 5000,
      forgetAfterMs: 20_000,
    });

    const plane = track({
      trackId: "CTV606",
      protocol: "asterix-cat020",
      onGround: true,
    });
    expect(v.check(plane)).toEqual({ action: "pass" });

    // Advance 6s (stale)
    c.advance(6000);
    v.sweep();
    expect(v.stats().retractedTracks).toBe(1);

    // Advance 25s (forgotten)
    c.advance(25_000);
    v.sweep();
    // Re-appearing after forget starts fresh
    expect(v.check(plane)).toEqual({ action: "pass" });
  });

  test("does nothing when disabled", () => {
    const v = createMlatValidator({ enabled: false });
    const crazy = track({
      trackId: "OFF707",
      protocol: "asterix-cat020",
      onGround: true,
      groundSpeed: 9999,
    });
    expect(v.check(crazy)).toEqual({ action: "pass" });
  });
});
