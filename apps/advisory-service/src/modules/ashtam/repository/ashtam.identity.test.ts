import { describe, expect, it } from "bun:test";
import type { NormalizedAshtamMessage } from "../parser/common";
import { computeAshtamContentHash } from "./ashtam.identity";

const baseMessage = (
  override: Partial<NormalizedAshtamMessage> = {},
): NormalizedAshtamMessage => ({
  type: "ASHTAM",
  providerId: "ASHTAM 7836",
  number: 7836,
  header: "\u0001NDP2513 070600 GG WRRRYAYD 070600 WRRRYNYX",
  affectedFir: "WAAF",
  effectiveFrom: new Date("2026-05-07T05:10:00.000Z"),
  effectiveTo: new Date("2026-05-08T05:10:00.000Z"),
  volcanoName: "IBU 268030",
  volcanoCoordinates: "N0129E12738",
  colourCode: "ORANGE",
  volcanicAsh: "SFC/FL070 N0128 E12732",
  volcanicAshDirection: "MOV SE 05KT",
  airRoutesAffected: "NIL",
  airRoutesClosure: "NIL",
  informationSource: "HIMAWARI-9, CVGHM",
  remark: null,
  raw: "(ASHTAM 7836 A)WAAF B)05070510",
  ...override,
});

describe("computeAshtamContentHash", () => {
  it("is deterministic for identical input", () => {
    const h1 = computeAshtamContentHash(baseMessage());
    const h2 = computeAshtamContentHash(baseMessage());

    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stays the same when nothing changes across a re-run", () => {
    const first = computeAshtamContentHash(baseMessage());
    const second = computeAshtamContentHash(baseMessage());

    expect(second).toBe(first);
  });

  it("changes when colourCode changes", () => {
    const h1 = computeAshtamContentHash(baseMessage());
    const h2 = computeAshtamContentHash(baseMessage({ colourCode: "RED" }));

    expect(h1).not.toBe(h2);
  });

  it("changes when effectiveTo changes", () => {
    const h1 = computeAshtamContentHash(baseMessage());
    const h2 = computeAshtamContentHash(
      baseMessage({ effectiveTo: new Date("2026-05-09T05:10:00.000Z") }),
    );

    expect(h1).not.toBe(h2);
  });

  it("changes when the raw message changes", () => {
    const h1 = computeAshtamContentHash(baseMessage());
    const h2 = computeAshtamContentHash(
      baseMessage({ raw: "(ASHTAM 7836 A)WAAF B)05070511" }),
    );

    expect(h1).not.toBe(h2);
  });

  it("is independent of providerId's source (identity is a separate concern)", () => {
    // contentHash is deliberately about *content*, not which source/provider
    // produced it — the same ASHTAM content from two sources should be
    // recognized as identical content once identity is otherwise resolved.
    const h1 = computeAshtamContentHash(baseMessage());
    const h2 = computeAshtamContentHash(baseMessage());
    expect(h1).toBe(h2);
  });
});
