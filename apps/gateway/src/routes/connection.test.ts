import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";

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

// Set before the modules read the environment.
process.env.JWT_SECRET = "gateway-test-secret";
process.env.CONNECTION_API_TOKENS =
  " svc-token-aaaaaaaaaaaa , other-token-bbbbbbbb";

const { default: connection } = await import("./connection");
const { connectionServiceToken } = await import("../config/connection-token");
const app = new Hono().route("/aero/tracks", connection);

const login = (): Promise<string> =>
  sign(
    { sub: "u1", exp: Math.floor(Date.now() / 1000) + 600 },
    "gateway-test-secret",
    "HS256",
  );

beforeEach(() => {
  axiosRequest.mockClear();
});

describe("/aero/tracks through the gateway", () => {
  it("lets a logged-in user through with the same path and query, and presents the service token, not the user's", async () => {
    const jwt = await login();
    const res = await app.request(
      "/aero/tracks/abc/trail?tz=Asia/Jakarta&sinceMs=5",
      {
        headers: { authorization: `Bearer ${jwt}` },
      },
    );
    expect(res.status).toBe(200);
    const sent = axiosRequest.mock.calls[0]?.[0];
    expect(new URL(sent?.url ?? "").pathname).toBe("/aero/tracks/abc/trail");
    expect(new URL(sent?.url ?? "").search).toBe("?tz=Asia/Jakarta&sinceMs=5");
    expect(sent?.headers.authorization).toBe("Bearer svc-token-aaaaaaaaaaaa");
    expect(sent?.headers.authorization).not.toContain(jwt);
  });

  it("refuses a request without a login, a bad JWT, or the service token itself, and never reaches upstream", async () => {
    const attempts: Array<Record<string, string>> = [
      {},
      { authorization: "Bearer not-a-jwt" },
      { authorization: "Bearer svc-token-aaaaaaaaaaaa" },
    ];
    for (const headers of attempts) {
      const res = await app.request("/aero/tracks/abc/trail", { headers });
      expect(res.status).toBe(401);
    }
    expect(axiosRequest).not.toHaveBeenCalled();
  });

  it("does not expose the rest of connection-service", async () => {
    const res = await app.request("/aero/ingest/events", { method: "POST" });
    expect(res.status).toBe(404);
    expect(axiosRequest).not.toHaveBeenCalled();
  });
});

describe("connectionServiceToken", () => {
  it("prefers the explicit token, else the first of CONNECTION_API_TOKENS", () => {
    expect(
      connectionServiceToken({
        CONNECTION_SERVICE_TOKEN: " x ",
        CONNECTION_API_TOKENS: "a,b",
        AEROSWARM_MONITOR_TOKENS: undefined,
      }),
    ).toBe("x");
    expect(
      connectionServiceToken({
        CONNECTION_SERVICE_TOKEN: undefined,
        CONNECTION_API_TOKENS: " a , b",
        AEROSWARM_MONITOR_TOKENS: undefined,
      }),
    ).toBe("a");
    expect(
      connectionServiceToken({
        CONNECTION_SERVICE_TOKEN: "",
        CONNECTION_API_TOKENS: ",,",
        AEROSWARM_MONITOR_TOKENS: undefined,
      }),
    ).toBeUndefined();
    expect(
      connectionServiceToken({
        CONNECTION_SERVICE_TOKEN: undefined,
        CONNECTION_API_TOKENS: undefined,
        AEROSWARM_MONITOR_TOKENS: undefined,
      }),
    ).toBeUndefined();
    // The name this deployment's .env uses for the same list.
    expect(
      connectionServiceToken({
        CONNECTION_SERVICE_TOKEN: undefined,
        CONNECTION_API_TOKENS: undefined,
        AEROSWARM_MONITOR_TOKENS: "legacy-1,legacy-2",
      }),
    ).toBe("legacy-1");
  });
});
