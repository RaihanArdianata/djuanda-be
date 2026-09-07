import { describe, expect, it } from "bun:test";
import healthRoute from "./health";

describe("GET /", () => {
  it("returns 200 with status ok", async () => {
    const res = await healthRoute.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});
