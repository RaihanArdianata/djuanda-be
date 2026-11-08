import { describe, expect, it } from "bun:test";
import {
  chunk,
  planVerification,
  type VerifiableAlert,
} from "./incident-verify";

const alert = (
  n: number,
  over: Partial<VerifiableAlert> = {},
): VerifiableAlert => ({
  id: `id${n}`,
  alertId: `a${n}`,
  severity: "WARNING",
  verificationStatus: "UNVERIFIED",
  verificationNote: null,
  ...over,
});

const input = {
  status: "VERIFIED" as const,
  note: undefined,
  onlyUnverified: false,
};

describe("planVerification", () => {
  it("targets every alert of the incident", () => {
    const plan = planVerification([alert(1), alert(2)], input);
    expect(plan.targets).toHaveLength(2);
    expect(plan.skipped).toHaveLength(0);
  });

  it("leaves judged alerts alone in apply-also mode", () => {
    const plan = planVerification(
      [alert(1, { verificationStatus: "FALSE_ALARM" }), alert(2)],
      { ...input, onlyUnverified: true },
    );
    expect(plan.targets.map((a) => a.alertId)).toEqual(["a2"]);
    expect(plan.skipped.map((a) => a.alertId)).toEqual(["a1"]);
  });

  it("overwrites an earlier judgement when verifying the whole incident", () => {
    const plan = planVerification(
      [alert(1, { verificationStatus: "FALSE_ALARM" })],
      input,
    );
    expect(plan.targets).toHaveLength(1);
  });

  it("skips what already holds the same judgement and note, so a retried job does not log twice", () => {
    const done = alert(1, {
      verificationStatus: "VERIFIED",
      verificationNote: "tower",
    });
    const plan = planVerification([done, alert(2)], {
      ...input,
      note: "tower",
    });
    expect(plan.skipped.map((a) => a.alertId)).toEqual(["a1"]);
    expect(plan.targets.map((a) => a.alertId)).toEqual(["a2"]);
  });

  it("asks for confirmation only when a critical alert would be changed", () => {
    expect(
      planVerification([alert(1, { severity: "CRITICAL" })], input)
        .needsCriticalConfirmation,
    ).toBe(true);
    expect(
      planVerification([alert(1), alert(2)], input).needsCriticalConfirmation,
    ).toBe(false);
    // a critical alert that is skipped does not need it
    const plan = planVerification(
      [alert(1, { severity: "CRITICAL", verificationStatus: "VERIFIED" })],
      { ...input, onlyUnverified: true },
    );
    expect(plan.needsCriticalConfirmation).toBe(false);
  });
});

describe("chunk", () => {
  it("cuts a list into groups, the last one smaller", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("refuses a size below one", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
