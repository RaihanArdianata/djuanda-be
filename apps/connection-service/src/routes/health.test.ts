import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

// health.ts only depends on Hono (no DB/Redis/Kafka), so it can be imported
// directly — it's mounted under /health the same way routes/index.ts does,
// to exercise the real public path.
const { default: health } = await import("./health");
const app = new Hono().route("/health", health);

describe("GET /health", () => {
  it("returns 200 with an ok status payload", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.process.status).toBe("healthy");
  });
});
