import { describe, expect, test } from "bun:test";
import { createConfirmationGate } from "./confirmation";

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number): void => {
      t += ms;
    },
  };
}

describe("confirmation gate", () => {
  test("confirms at once when no waiting time is asked", () => {
    const gate = createConfirmationGate();
    expect(gate.confirm("a", 0)).toBe(true);
  });

  test("confirms only after the condition has held for the asked time", () => {
    const c = clock();
    const gate = createConfirmationGate({ now: c.now });
    expect(gate.confirm("a", 3)).toBe(false);
    c.advance(1000);
    expect(gate.confirm("a", 3)).toBe(false);
    c.advance(2000);
    expect(gate.confirm("a", 3)).toBe(true);
  });

  test("stays confirmed while it is seen without a break", () => {
    const c = clock();
    const gate = createConfirmationGate({ now: c.now });
    gate.confirm("a", 3);
    for (let i = 0; i < 5; i++) {
      c.advance(1000);
      gate.confirm("a", 3);
    }
    expect(gate.confirm("a", 3)).toBe(true);
  });

  test("starts over after a gap longer than gapMs (the condition went away and came back)", () => {
    const c = clock();
    const gate = createConfirmationGate({ now: c.now, gapMs: 5_000 });
    gate.confirm("a", 3);
    c.advance(4000);
    expect(gate.confirm("a", 3)).toBe(true);
    c.advance(6000); // gone for 6 s: over the gap
    expect(gate.confirm("a", 3)).toBe(false);
  });

  test("a flicker shorter than the gap does not restart the count", () => {
    const c = clock();
    const gate = createConfirmationGate({ now: c.now, gapMs: 5_000 });
    gate.confirm("a", 6);
    c.advance(3000);
    gate.confirm("a", 6);
    c.advance(3000);
    expect(gate.confirm("a", 6)).toBe(true);
  });

  test("keeps the conditions apart", () => {
    const c = clock();
    const gate = createConfirmationGate({ now: c.now });
    gate.confirm("a", 3);
    c.advance(3000);
    expect(gate.confirm("a", 3)).toBe(true);
    expect(gate.confirm("b", 3)).toBe(false);
  });

  test("forgets conditions that have not been seen for a long time", () => {
    const c = clock();
    const gate = createConfirmationGate({ now: c.now, forgetAfterMs: 1000 });
    gate.confirm("a", 3);
    expect(gate.size()).toBe(1);
    c.advance(5000);
    gate.sweep();
    expect(gate.size()).toBe(0);
  });
});
