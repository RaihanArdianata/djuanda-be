import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

interface Forwarded {
  url: string;
  headers: Record<string, string>;
}

const axiosRequest = mock(async (_config: Forwarded) => ({
  status: 200,
  headers: { "content-type": "application/json" },
  data: '{"ok":true}',
}));
mock.module("axios", () => ({ default: { request: axiosRequest } }));

const { default: connection } = await import("./connection");
const app = new Hono().route("/aero/tracks", connection);

beforeEach(() => {
  axiosRequest.mockClear();
});

describe("/aero/tracks through the gateway", () => {
  it("reaches connection-service with the same path, query and Authorization header", async () => {
    const res = await app.request(
      "/aero/tracks/abc/trail?tz=Asia/Jakarta&sinceMs=5",
      { headers: { authorization: "Bearer secret" } },
    );
    expect(res.status).toBe(200);
    const sent = axiosRequest.mock.calls[0]?.[0];
    expect(new URL(sent?.url ?? "").pathname).toBe("/aero/tracks/abc/trail");
    expect(new URL(sent?.url ?? "").search).toBe("?tz=Asia/Jakarta&sinceMs=5");
    expect(sent?.headers.authorization).toBe("Bearer secret");
  });

  it("does not expose the rest of connection-service", async () => {
    const res = await app.request("/aero/ingest/events", { method: "POST" });
    expect(res.status).toBe(404);
    expect(axiosRequest).not.toHaveBeenCalled();
  });
});
