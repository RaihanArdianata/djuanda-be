import { describe, expect, it } from "bun:test";
import { withoutAsterixItems } from "./strip-asterix-items";

describe("withoutAsterixItems", () => {
  const event = {
    trackId: "ast_1",
    meta: {
      sourceType: "ASTERIX_UDP",
      port: 18600,
      asterix: { category: 20, items: { "010": { SAC: 1 } } },
    },
  };

  it("removes the decoded items and keeps the rest of meta", () => {
    const out = withoutAsterixItems(event);
    expect(out.meta).toEqual({ sourceType: "ASTERIX_UDP", port: 18600 });
    expect(out.trackId).toBe("ast_1");
  });

  it("does not change the original event", () => {
    withoutAsterixItems(event);
    expect(event.meta.asterix.category).toBe(20);
  });

  it("returns the same object when there is nothing to remove", () => {
    const plain = { trackId: "ast_2", meta: { port: 1 } };
    expect(withoutAsterixItems(plain)).toBe(plain);
    const noMeta = { trackId: "ast_3" };
    expect(withoutAsterixItems(noMeta)).toBe(noMeta);
  });
});
