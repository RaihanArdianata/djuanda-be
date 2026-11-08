import { describe, expect, it } from "bun:test";
import { readableName } from "./feature-name";

describe("readableName", () => {
  it("keeps a real name", () => {
    expect(readableName("NP2")).toBe("NP2");
    expect(readableName("  10/28 ")).toBe("10/28");
  });

  it("is undefined for no name, a blank name, or an id", () => {
    expect(readableName(undefined)).toBeUndefined();
    expect(readableName(null)).toBeUndefined();
    expect(readableName("   ")).toBeUndefined();
    expect(
      readableName("be78e0d8-57ab-4e8c-a773-12e376858d68"),
    ).toBeUndefined();
    expect(
      readableName("BE78E0D8-57AB-4E8C-A773-12E376858D68"),
    ).toBeUndefined();
  });
});
