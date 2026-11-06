import { describe, expect, test } from "bun:test";
import { cpuPercent, readCpuTimes, systemStatus } from "./system-status";

describe("cpuPercent", () => {
  test("is the share of non-idle time between two samples", () => {
    expect(
      cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 }),
    ).toBe(50);
    expect(cpuPercent({ idle: 0, total: 0 }, { idle: 0, total: 100 })).toBe(
      100,
    );
    expect(cpuPercent({ idle: 0, total: 0 }, { idle: 100, total: 100 })).toBe(
      0,
    );
  });

  test("is 0 when no time has passed", () => {
    expect(cpuPercent({ idle: 5, total: 10 }, { idle: 5, total: 10 })).toBe(0);
  });
});

describe("readCpuTimes", () => {
  test("adds the times of every core", () => {
    const core = { user: 10, nice: 0, sys: 5, idle: 85, irq: 0 };
    const cpus = [
      { model: "x", speed: 1, times: core },
      { model: "x", speed: 1, times: core },
    ];
    expect(readCpuTimes(cpus)).toEqual({ idle: 170, total: 200 });
  });
});

describe("systemStatus", () => {
  test("returns sane numbers", () => {
    const s = systemStatus();
    expect(s.memUsedPct).toBeGreaterThanOrEqual(0);
    expect(s.memUsedPct).toBeLessThanOrEqual(100);
    expect(s.rssMb).toBeGreaterThan(0);
    expect(s.cpuPct).toBeGreaterThanOrEqual(0);
  });
});
