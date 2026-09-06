import { describe, expect, it } from "bun:test";

const { default: healthRoute } = await import("./health");

describe("GET /health", () => {
  it("returns 200 with a status ok payload", async () => {
    const res = await healthRoute.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});
