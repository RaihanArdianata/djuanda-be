import { describe, expect, it } from "bun:test";
import type { NormalizedAftnMessage } from "../parser/common";
import { computeAftnContentHash, computeAftnProviderId } from "./aftn.identity";

const baseMessage = (
  override: Partial<NormalizedAftnMessage> = {},
): NormalizedAftnMessage => ({
  datetime: new Date("2026-05-30T23:58:22.000Z"),
  messageType: "FPL",
  callSign: "AXM5868",
  registration: "9MRAN",
  aircraftType: "A320",
  departure: "WMKK",
  departureTime: "0930",
  destination: "WBGS",
  destinationTime: null,
  duration: "0146",
  speed: "N045",
  altitude: "F330",
  route: "PIBOS DCT VMR",
  raw: "(FPL-AXM5868-IS-A320/M-...-WBGS0146)",
  parsed: { dof: "260530" },
  ...override,
});

describe("computeAftnProviderId", () => {
  it("is deterministic for the same message and source", () => {
    const id1 = computeAftnProviderId(baseMessage(), "navsim-aftn");
    const id2 = computeAftnProviderId(baseMessage(), "navsim-aftn");

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when the source changes", () => {
    const id1 = computeAftnProviderId(baseMessage(), "navsim-aftn");
    const id2 = computeAftnProviderId(baseMessage(), "other");

    expect(id1).not.toBe(id2);
  });

  it("changes when the raw message changes", () => {
    const id1 = computeAftnProviderId(baseMessage(), "navsim-aftn");
    const id2 = computeAftnProviderId(
      baseMessage({ raw: "(FPL-AXM5868-WHICH-ROUTE)" }),
      "navsim-aftn",
    );

    expect(id1).not.toBe(id2);
  });

  it("whitespace variations in raw do not change the id", () => {
    const id1 = computeAftnProviderId(
      baseMessage({ raw: "  (FPL  AXM5868)  " }),
      "navsim-aftn",
    );
    const id2 = computeAftnProviderId(
      baseMessage({ raw: "(FPL AXM5868)" }),
      "navsim-aftn",
    );

    expect(id1).toBe(id2);
  });
});

describe("computeAftnContentHash", () => {
  it("is deterministic", () => {
    const h1 = computeAftnContentHash(baseMessage());
    const h2 = computeAftnContentHash(baseMessage());

    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when a normalized field changes", () => {
    const h1 = computeAftnContentHash(baseMessage());
    const h2 = computeAftnContentHash(baseMessage({ altitude: "F350" }));

    expect(h1).not.toBe(h2);
  });

  it("changes when parsed extras change", () => {
    const h1 = computeAftnContentHash(baseMessage());
    const h2 = computeAftnContentHash(
      baseMessage({ parsed: { dof: "260531" } }),
    );

    expect(h1).not.toBe(h2);
  });

  it("changes when the raw message changes", () => {
    const h1 = computeAftnContentHash(
      baseMessage({ raw: "(FPL-AXM5868-IS-A320/M)" }),
    );
    const h2 = computeAftnContentHash(
      baseMessage({ raw: "(FPL-AXM5868-IS-A320/N)" }),
    );

    expect(h1).not.toBe(h2);
  });
});
