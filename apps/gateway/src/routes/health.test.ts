import { beforeEach, describe, expect, it, mock } from "bun:test";

// /ready pings upstream services over HTTP -- stub the health-check client so
// these tests exercise only the route's aggregation logic, with no real
// outbound requests.
const isServiceHealthy = mock(
  async (_baseUrl: string): Promise<boolean> => true,
);

mock.module("../lib/http-client", () => ({
  isServiceHealthy,
}));

// Imported dynamically, after the mock above is registered, so the route
// picks up the stubbed http-client instead of the real one.
const { default: healthRoute } = await import("./health");

beforeEach(() => {
  isServiceHealthy.mockReset();
});

describe("GET /", () => {
  it("returns 200 with status ok", async () => {
    const res = await healthRoute.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});

describe("GET /live", () => {
  it("returns 200 with status ok", async () => {
    const res = await healthRoute.request("/live");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});

describe("GET /ready", () => {
  it("returns 200 when every upstream dependency is healthy", async () => {
    isServiceHealthy.mockResolvedValue(true);

    const res = await healthRoute.request("/ready");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.services).toEqual({ auth: true, notification: true });
    expect(isServiceHealthy).toHaveBeenCalledTimes(2);
  });

  it("returns 503 degraded when an upstream dependency is down", async () => {
    isServiceHealthy.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const res = await healthRoute.request("/ready");
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.services).toEqual({ auth: true, notification: false });
  });
});
