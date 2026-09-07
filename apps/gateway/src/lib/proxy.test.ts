import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { DEFAULT_TIMEOUT_MS, REQUEST_ID_HEADER } from "../config/constants";
import type { Variables } from "../types/hono";

interface AxiosRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  data?: ArrayBuffer;
  timeout: number;
  responseType: string;
  validateStatus: (status: number) => boolean;
}

interface AxiosResponseLike {
  status: number;
  headers: Record<string, string>;
  data: string;
}

// The proxy forwards upstream traffic via axios -- stub it so no real HTTP
// leaves the test process and we can inspect exactly what was forwarded.
const axiosRequest = mock(
  async (_config: AxiosRequestConfig): Promise<AxiosResponseLike> => ({
    status: 200,
    headers: { "content-type": "application/json" },
    data: "{}",
  }),
);

mock.module("axios", () => ({
  default: { request: axiosRequest },
}));

// Imported dynamically, after the axios mock is registered.
const { createProxy } = await import("./proxy");

const buildApp = (withRequestId: boolean) => {
  const app = new Hono<{ Variables: Variables }>();

  if (withRequestId) {
    app.use("*", async (c, next) => {
      c.set("requestId", "req-123");
      await next();
    });
  }

  app.all("/api/*", createProxy("http://upstream.test"));
  return app;
};

beforeEach(() => {
  axiosRequest.mockReset();
  axiosRequest.mockResolvedValue({
    status: 200,
    headers: { "content-type": "application/json" },
    data: "{}",
  });
});

describe("createProxy", () => {
  it("forwards the method, path and query string to the target base URL", async () => {
    const app = buildApp(true);

    await app.request("/api/flights/list?status=active&page=2");

    expect(axiosRequest).toHaveBeenCalledTimes(1);
    const config = axiosRequest.mock.calls[0][0];
    expect(config.url).toBe(
      "http://upstream.test/api/flights/list?status=active&page=2",
    );
    expect(config.method).toBe("GET");
  });

  it("forwards the request-id header and drops hop-by-hop headers", async () => {
    const app = buildApp(true);

    await app.request("/api/ping", {
      headers: {
        host: "gateway.local",
        connection: "keep-alive",
        "x-custom-header": "kept",
      },
    });

    const config = axiosRequest.mock.calls[0][0];
    expect(config.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe("req-123");
    expect(config.headers["x-custom-header"]).toBe("kept");
    expect(config.headers.host).toBeUndefined();
    expect(config.headers.connection).toBeUndefined();
  });

  it("omits the request-id header when none is set on the context", async () => {
    const app = buildApp(false);

    await app.request("/api/ping");

    const config = axiosRequest.mock.calls[0][0];
    expect(config.headers[REQUEST_ID_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("applies the default timeout and never rejects on upstream error statuses", async () => {
    const app = buildApp(true);

    await app.request("/api/ping");

    const config = axiosRequest.mock.calls[0][0];
    expect(config.timeout).toBe(DEFAULT_TIMEOUT_MS);
    expect(config.responseType).toBe("stream");
    expect(config.validateStatus(500)).toBe(true);
    expect(config.validateStatus(200)).toBe(true);
  });

  it("sends the request body for non-GET/HEAD methods", async () => {
    const app = buildApp(true);

    await app.request("/api/submit", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello upstream",
    });

    const config = axiosRequest.mock.calls[0][0];
    expect(config.method).toBe("POST");
    expect(config.data).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(config.data)).toBe("hello upstream");
  });

  it("maps the upstream status, headers and body onto the gateway response", async () => {
    axiosRequest.mockResolvedValue({
      status: 201,
      headers: { "x-upstream": "yes", "content-type": "application/json" },
      data: '{"created":true}',
    });
    const app = buildApp(true);

    const res = await app.request("/api/create");

    expect(res.status).toBe(201);
    expect(res.headers.get("x-upstream")).toBe("yes");
    expect(await res.text()).toBe('{"created":true}');
  });

  it("returns a 5xx response instead of crashing when the upstream call fails", async () => {
    axiosRequest.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const app = buildApp(true);

    const res = await app.request("/api/down");

    expect(res.status).toBe(500);
  });
});
