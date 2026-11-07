import { afterEach, describe, expect, it } from "bun:test";
import type { Bbox } from "@aeroswarm/live-server";
import {
  bboxAround,
  type InterestRule,
  interestBboxFromRule,
  startInterestSync,
} from "./interest-area";

const rule = (
  configuration: Record<string, unknown>,
  enabled = true,
): InterestRule => ({ enabled, configuration });
const WARR = { centerLatitude: -7.3797, centerLongitude: 112.7868 };

describe("bboxAround", () => {
  it("makes a box that reaches the radius north and east, a little wider in longitude", () => {
    const box = bboxAround(-7.3797, 112.7868, 10) as Bbox;
    // 10 NM = 18.52 km = about 0.1664 degrees of latitude
    expect(box[3] - -7.3797).toBeCloseTo(0.1664, 3);
    expect(box[2] - 112.7868).toBeCloseTo(0.1678, 3);
    expect(box[0]).toBeLessThan(112.7868);
    expect(box[1]).toBeLessThan(-7.3797);
  });

  it("is undefined without a usable radius or near the poles", () => {
    expect(bboxAround(0, 0, 0)).toBeUndefined();
    expect(bboxAround(0, 0, -5)).toBeUndefined();
    expect(bboxAround(89.5, 0, 10)).toBeUndefined();
  });
});

describe("interestBboxFromRule", () => {
  it("is built from the centre and interestRadiusNm of the rule", () => {
    const box = interestBboxFromRule(
      rule({ ...WARR, interestRadiusNm: 20 }),
      {},
    ) as Bbox;
    expect(box[2] - box[0]).toBeCloseTo(2 * 0.3357, 2);
  });

  it("takes the centre from ALERT_AREA_CENTER when the rule has none", () => {
    expect(
      interestBboxFromRule(rule({ interestRadiusNm: 20 }), {
        ALERT_AREA_CENTER: "-7.3797,112.7868",
      }),
    ).toBeDefined();
    expect(
      interestBboxFromRule(rule({ interestRadiusNm: 20 }), {}),
    ).toBeUndefined();
  });

  it("is undefined, so the env box applies, without a radius, with the rule off, or with no rule", () => {
    expect(interestBboxFromRule(rule(WARR), {})).toBeUndefined();
    expect(
      interestBboxFromRule(rule({ ...WARR, interestRadiusNm: 20 }, false), {}),
    ).toBeUndefined();
    expect(interestBboxFromRule(undefined, {})).toBeUndefined();
  });
});

describe("startInterestSync", () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });
  const wait = (ms = 15) => new Promise((r) => setTimeout(r, ms));
  const envBox: Bbox = [112.6, -7.5, 112.9, -7.2];

  it("applies the box of the rule at once and again when the rule changes", async () => {
    const applied: (Bbox | undefined)[] = [];
    let current = rule({ ...WARR, interestRadiusNm: 20 });
    stops.push(
      startInterestSync({
        target: { setInterest: (i) => applied.push(i.interestBbox) },
        fallback: envBox,
        fetchRule: async () => current,
        intervalMs: 5,
        env: {},
      }),
    );
    await wait();
    expect(applied).toHaveLength(1);
    current = rule({ ...WARR, interestRadiusNm: 30 });
    await wait();
    expect(applied).toHaveLength(2);
    // nothing changed: nothing applied
    await wait();
    expect(applied).toHaveLength(2);
  });

  it("goes back to the env box when the rule goes away", async () => {
    const applied: (Bbox | undefined)[] = [];
    let current: InterestRule | undefined = rule({
      ...WARR,
      interestRadiusNm: 20,
    });
    stops.push(
      startInterestSync({
        target: { setInterest: (i) => applied.push(i.interestBbox) },
        fallback: envBox,
        fetchRule: async () => current,
        intervalMs: 5,
        env: {},
      }),
    );
    await wait();
    current = undefined;
    await wait();
    expect(applied.at(-1)).toEqual(envBox);
  });

  it("applies nothing while the rule gives no box and the env box is already in force", async () => {
    const applied: unknown[] = [];
    stops.push(
      startInterestSync({
        target: { setInterest: (i) => applied.push(i) },
        fallback: envBox,
        fetchRule: async () => undefined,
        intervalMs: 5,
        env: {},
      }),
    );
    await wait();
    expect(applied).toEqual([]);
  });

  it("keeps the box in force when the database cannot be read, and warns once for an old live-server", async () => {
    const warnings: unknown[] = [];
    stops.push(
      startInterestSync({
        target: {},
        fallback: undefined,
        fetchRule: async () => rule({ ...WARR, interestRadiusNm: 20 }),
        intervalMs: 5,
        env: {},
        log: { info: () => undefined, warn: (o) => warnings.push(o) },
      }),
    );
    await wait(30);
    expect(warnings).toHaveLength(1);

    const failing: unknown[] = [];
    const applied: unknown[] = [];
    stops.push(
      startInterestSync({
        target: { setInterest: (i) => applied.push(i) },
        fallback: envBox,
        fetchRule: async () => {
          throw new Error("db down");
        },
        intervalMs: 5,
        env: {},
        log: { info: () => undefined, warn: (o) => failing.push(o) },
      }),
    );
    await wait();
    expect(applied).toEqual([]);
    expect(failing.length).toBeGreaterThan(0);
  });
});
