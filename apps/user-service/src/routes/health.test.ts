import { describe, expect, it } from "bun:test";

import healthRoute from "./health";

describe("GET /health", () => {
  it("returns 200 with an ok status payload", async () => {
    const res = await healthRoute.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });
});
