import { beforeEach, describe, expect, it, mock } from "bun:test";
import { FakeRedis } from "@repo/shared/testing/fakeRedis";
import { Hono } from "hono";
import { sign } from "hono/jwt";

// Shared fake (packages/shared/src/testing/fakeRedis.ts) — mock.module is
// process-wide in bun test; all files must register the same fake so other
// files' module graphs never see an incomplete stub.
mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

const getUserById = mock();
const validateAccessToken = mock();

mock.module("./service", () => ({
  getUserById,
  validateAccessToken,
}));

const { authentication, rbacMiddleware } = await import("./middleware");

process.env.JWT_SECRET = "test-secret";

type ApiEnvelope = {
  data: unknown;
  error: { code: string } | null;
  meta: { code: number; status: string; message?: string };
};

const token = async (payload: { id: string; email: string; role: string }) =>
  sign(
    { ...payload, exp: Math.floor(Date.now() / 1000) + 3600 },
    "test-secret",
    "HS256",
  );

beforeEach(() => {
  getUserById.mockReset();
  validateAccessToken.mockReset();
});

const authHeader = (t: string) => ({
  headers: { Authorization: `Bearer ${t}` },
});

describe("authentication middleware", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const app = new Hono()
      .use(authentication)
      .get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  it("sets user and continues for a valid active user", async () => {
    const t = await token({ id: "u1", email: "u@example.com", role: "USER" });
    getUserById.mockResolvedValue({
      id: "u1",
      email: "u@example.com",
      username: "user",
      name: "User",
      status: "ACTIVE",
      role: {
        id: 1,
        name: "USER",
        rolePermissions: [{ permission: { code: "USERS.VIEW" } }],
      },
      permissions: ["USERS.VIEW"],
    });
    validateAccessToken.mockResolvedValue({ isValid: true, isExpired: false });

    const app = new Hono<{ Variables: { user: { id: string } } }>()
      .use(authentication)
      .get("/", (c) => c.json({ user: c.get("user") }));
    const res = await app.request("/", authHeader(t));
    const body = (await res.json()) as { user: { id: string } };

    expect(res.status).toBe(200);
    expect(body.user.id).toBe("u1");
  });

  it("returns 401 when user is not found", async () => {
    const t = await token({
      id: "missing",
      email: "missing@example.com",
      role: "USER",
    });
    getUserById.mockResolvedValue(null);
    validateAccessToken.mockResolvedValue({ isValid: true, isExpired: false });

    const app = new Hono()
      .use(authentication)
      .get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/", authHeader(t));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when user is inactive", async () => {
    const t = await token({ id: "u1", email: "u@example.com", role: "USER" });
    getUserById.mockResolvedValue({
      id: "u1",
      status: "INACTIVE",
      role: null,
      permissions: [],
    });

    const app = new Hono()
      .use(authentication)
      .get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/", authHeader(t));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  it("returns INVALID_ACCESS_TOKEN when the access token is expired", async () => {
    const t = await token({ id: "u1", email: "u@example.com", role: "USER" });
    getUserById.mockResolvedValue({
      id: "u1",
      status: "ACTIVE",
      role: null,
      permissions: [],
    });
    validateAccessToken.mockResolvedValue({ isValid: false, isExpired: true });

    const app = new Hono()
      .use(authentication)
      .get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/", authHeader(t));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(401);
    expect(body.error?.code).toBe("INVALID_ACCESS_TOKEN");
  });

  it("returns SESSION_TERMINATED when the access token is invalid", async () => {
    const t = await token({ id: "u1", email: "u@example.com", role: "USER" });
    getUserById.mockResolvedValue({
      id: "u1",
      status: "ACTIVE",
      role: null,
      permissions: [],
    });
    validateAccessToken.mockResolvedValue({ isValid: false, isExpired: false });

    const app = new Hono()
      .use(authentication)
      .get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/", authHeader(t));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(401);
    expect(body.error?.code).toBe("SESSION_TERMINATED");
  });
});

describe("rbacMiddleware", () => {
  it("allows requests with a matching permission", async () => {
    const t = await token({ id: "u1", email: "u@example.com", role: "USER" });
    getUserById.mockResolvedValue({
      id: "u1",
      status: "ACTIVE",
      role: {
        id: 1,
        name: "USER",
        rolePermissions: [{ permission: { code: "USERS.VIEW" } }],
      },
      permissions: ["USERS.VIEW"],
    });
    validateAccessToken.mockResolvedValue({ isValid: true, isExpired: false });

    const app = new Hono()
      .use(authentication)
      .use(rbacMiddleware)
      .get("/users", (c) => c.json({ ok: true }));
    const res = await app.request("/users", authHeader(t));

    expect(res.status).toBe(200);
  });

  it("denies requests without a matching permission method", async () => {
    const t = await token({ id: "u1", email: "u@example.com", role: "USER" });
    getUserById.mockResolvedValue({
      id: "u1",
      status: "ACTIVE",
      role: {
        id: 1,
        name: "USER",
        rolePermissions: [{ permission: { code: "USERS.CREATE" } }],
      },
      permissions: ["USERS.CREATE"],
    });
    validateAccessToken.mockResolvedValue({ isValid: true, isExpired: false });

    const app = new Hono()
      .use(authentication)
      .use(rbacMiddleware)
      .get("/users", (c) => c.json({ ok: true }));
    const res = await app.request("/users", authHeader(t));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
  });
});
