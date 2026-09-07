import { describe, expect, it } from "bun:test";
import health from "./health";

describe("GET /health", () => {
  it("returns 200 with a status ok payload", async () => {
    const res = await health.request("/");
    const body = (await res.json()) as { status: string };

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});
