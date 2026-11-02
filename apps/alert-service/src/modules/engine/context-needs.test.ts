import { describe, expect, it } from "bun:test";
import type { AlertRule } from "@repo/database";
import { contextNeeds } from "./alert.engine";

const rule = (type: string): AlertRule => ({ type }) as AlertRule;

describe("contextNeeds", () => {
  it("needs no optional context for the rules that exist today", () => {
    // None of these rules reads weather, AFTN or NOTAM, so none of it is fetched per evaluation.
    const needs = contextNeeds([
      rule("STCA"),
      rule("RUNWAY_INCURSION"),
      rule("TAXIWAY_APRON_INCURSION"),
      rule("AREA_PENETRATION"),
      rule("DEVIATION"),
    ]);
    expect(needs.size).toBe(0);
  });

  it("ignores rule types that have no detector", () => {
    expect(contextNeeds([rule("SOMETHING_ELSE")]).size).toBe(0);
  });
});
