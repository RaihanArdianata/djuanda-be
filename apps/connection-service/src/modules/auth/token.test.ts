import { describe, expect, it } from "bun:test";
import {
  createTokenVerifier,
  parseTokenList,
  redactToken,
  tokensFromEnv,
} from "./token";

describe("parseTokenList", () => {
  it("splits on commas, trims, drops blanks and duplicates", () => {
    expect(parseTokenList(" a , b,, a ,c ")).toEqual(["a", "b", "c"]);
    expect(parseTokenList(undefined)).toEqual([]);
    expect(parseTokenList("")).toEqual([]);
  });
});

describe("tokensFromEnv", () => {
  it("merges the new variable with the legacy one without duplicates", () => {
    expect(
      tokensFromEnv({
        CONNECTION_API_TOKENS: "new1,shared",
        AEROSWARM_MONITOR_TOKENS: "shared,old1",
      }),
    ).toEqual(["new1", "shared", "old1"]);
  });

  it("works with only the legacy variable", () => {
    expect(tokensFromEnv({ AEROSWARM_MONITOR_TOKENS: "srctk_abc" })).toEqual([
      "srctk_abc",
    ]);
  });
});

describe("createTokenVerifier", () => {
  const v = createTokenVerifier({
    tokens: ["alpha-token", "beta-token"],
    airportId: "WARR",
  });

  it("accepts every configured token and pins the airport", () => {
    expect(v.verify("alpha-token")).toEqual({ airportId: "WARR" });
    expect(v.verify("beta-token")).toEqual({ airportId: "WARR" });
    expect(v.size).toBe(2);
  });

  it("rejects missing, empty, unknown and near-miss tokens", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "gamma-token",
      "alpha-toke",
      "alpha-token ",
      "ALPHA-TOKEN",
    ]) {
      expect(v.verify(bad)).toBeNull();
    }
  });

  it("returns a fresh object each time so callers cannot mutate the grant", () => {
    const a = v.verify("alpha-token");
    const b = v.verify("alpha-token");
    expect(a).not.toBe(b);
    if (a) a.airportId = "OTHER";
    expect(v.verify("alpha-token")).toEqual({ airportId: "WARR" });
  });

  it("grants no airport when none is configured (viewer token)", () => {
    const open = createTokenVerifier({ tokens: ["t"] });
    expect(open.verify("t")).toEqual({});
  });

  it("rejects everything when the list is empty", () => {
    const none = createTokenVerifier({ tokens: [] });
    expect(none.verify("anything")).toBeNull();
    expect(none.size).toBe(0);
  });

  it("supports rotation: both old and new work until the old one is removed", () => {
    const during = createTokenVerifier({ tokens: ["old", "new"] });
    expect(during.verify("old")).not.toBeNull();
    expect(during.verify("new")).not.toBeNull();
    const after = createTokenVerifier({ tokens: ["new"] });
    expect(after.verify("old")).toBeNull();
  });
});

describe("redactToken", () => {
  it("never reveals more than a short prefix", () => {
    expect(redactToken("srctk_abcdefghijkl")).toBe("srct…(18)");
    expect(redactToken(null)).toBe("(none)");
    expect(redactToken("")).toBe("(none)");
  });
});
