import { describe, expect, it } from "bun:test";
import {
  createEvaluationScheduler,
  evaluationIntervalFromEnv,
  maxEventAgeFromEnv,
} from "./evaluation-scheduler";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("evaluation scheduler", () => {
  it("coalesces a burst of requests into one evaluation", async () => {
    const seen: Date[] = [];
    const scheduler = createEvaluationScheduler({
      minIntervalMs: 20,
      evaluate: async (_airport, ts) => {
        seen.push(ts);
      },
    });
    const t = (ms: number): Date => new Date(1_000_000 + ms);
    for (let i = 0; i < 200; i++) scheduler.request("WARR", t(i));
    await sleep(80);
    scheduler.stop();

    expect(scheduler.stats().requested).toBe(200);
    expect(scheduler.stats().runs).toBeLessThan(5);
    // It evaluates with the newest timestamp it was asked about.
    expect(seen.at(-1)?.getTime()).toBe(t(199).getTime());
  });

  it("never runs two evaluations of one airport at the same time", async () => {
    let active = 0;
    let maxActive = 0;
    const scheduler = createEvaluationScheduler({
      minIntervalMs: 0,
      evaluate: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(15);
        active--;
      },
    });
    for (let i = 0; i < 10; i++) {
      scheduler.request("WARR", new Date(i));
      await sleep(3);
    }
    await sleep(80);
    scheduler.stop();
    expect(maxActive).toBe(1);
    expect(scheduler.stats().runs).toBeGreaterThan(1);
  });

  it("runs again for requests that arrive during an evaluation", async () => {
    let runs = 0;
    const scheduler = createEvaluationScheduler({
      minIntervalMs: 0,
      evaluate: async () => {
        runs++;
        await sleep(20);
      },
    });
    scheduler.request("WARR", new Date(1));
    await sleep(5);
    scheduler.request("WARR", new Date(2)); // arrives while the first is running
    await sleep(80);
    scheduler.stop();
    expect(runs).toBe(2);
  });

  it("keeps working after an evaluation throws", async () => {
    let calls = 0;
    const scheduler = createEvaluationScheduler({
      minIntervalMs: 0,
      evaluate: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
      },
    });
    scheduler.request("WARR", new Date(1));
    await sleep(15);
    scheduler.request("WARR", new Date(2));
    await sleep(15);
    scheduler.stop();
    expect(calls).toBe(2);
    expect(scheduler.stats().failures).toBe(1);
  });

  it("handles each airport independently", async () => {
    const airports: string[] = [];
    const scheduler = createEvaluationScheduler({
      minIntervalMs: 0,
      evaluate: async (airport) => {
        airports.push(airport);
      },
    });
    scheduler.request("WARR", new Date(1));
    scheduler.request("WIII", new Date(1));
    await sleep(15);
    scheduler.stop();
    expect(airports.sort()).toEqual(["WARR", "WIII"]);
  });
});

describe("evaluation settings from env", () => {
  it("defaults to 1 s between evaluations and ignores events older than 60 s", () => {
    expect(evaluationIntervalFromEnv({})).toBe(1_000);
    expect(evaluationIntervalFromEnv({ ALERT_EVAL_INTERVAL_MS: "250" })).toBe(
      250,
    );
    expect(evaluationIntervalFromEnv({ ALERT_EVAL_INTERVAL_MS: "-1" })).toBe(
      1_000,
    );
    expect(maxEventAgeFromEnv({})).toBe(60_000);
    expect(maxEventAgeFromEnv({ ALERT_MAX_EVENT_AGE_MS: "120000" })).toBe(
      120_000,
    );
    expect(maxEventAgeFromEnv({ ALERT_MAX_EVENT_AGE_MS: "0" })).toBe(60_000);
  });
});
