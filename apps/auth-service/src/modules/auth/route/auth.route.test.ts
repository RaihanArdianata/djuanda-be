import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
// Real submodules imported directly (bypassing the @repo/shared barrel) so the
// mocked barrel can re-export them — the barrel loads rateLimiter.ts which
// instantiates a nested ioredis copy that mock.module("ioredis") cannot reach.
import ApiError from "@repo/shared/src/apiError";
import {
  failure,
  failureFromCode,
  success,
} from "@repo/shared/src/apiResponse";
import { catchAsync } from "@repo/shared/src/catchAsync";
import {
  passwordSchema,
  transformPhoneNumber,
} from "@repo/shared/src/utils/formatter";
import {
  bcryptHash,
  bcryptVerify,
  sha256Hash,
} from "@repo/shared/src/utils/hashing";
import { generateRefreshToken } from "@/utils/jwt";

process.env.JWT_SECRET = "test-secret";

const checkRateLimit = mock(async () => ({ allowed: true, remaining: 5 }));
const resetRateLimit = mock(async () => undefined);

mock.module("@repo/shared", () => ({
  ApiError,
  catchAsync,
  failure,
  failureFromCode,
  success,
  bcryptHash,
  bcryptVerify,
  sha256Hash,
  passwordSchema,
  transformPhoneNumber,
  checkRateLimit,
  resetRateLimit,
}));

mock.module("hono/bun", () => ({
  getConnInfo: () => ({ remote: { address: "127.0.0.1" } }),
}));

const getUser = mock();
const createUser = mock();
const createUserSession = mock();
const saveRefreshToken = mock();
const rotateRefreshToken = mock();
const revokeRefreshToken = mock();
const revokeAllUserSessions = mock();

mock.module("../service/auth.service", () => ({
  getUser,
  createUser,
  createUserSession,
  saveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserSessions,
}));

const { default: authRoute } = await import("./auth.route");

type ApiEnvelope = {
  data: unknown;
  error: { code: string; fields?: Record<string, string[]> } | null;
  meta: { code: number; status: string; message?: string };
};

const validPassword = "Password123!";
let validPasswordHash = "";

beforeAll(async () => {
  validPasswordHash = await Bun.password.hash(validPassword, {
    algorithm: "bcrypt",
    cost: 12,
  });
});

beforeEach(() => {
  checkRateLimit.mockReset();
  checkRateLimit.mockResolvedValue({ allowed: true, remaining: 5 });
  resetRateLimit.mockReset();
  getUser.mockReset();
  createUser.mockReset();
  createUserSession.mockReset();
  saveRefreshToken.mockReset();
  rotateRefreshToken.mockReset();
  revokeRefreshToken.mockReset();
  revokeAllUserSessions.mockReset();
});

const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("POST /auth/login", () => {
  it("returns tokens and user profile on valid credentials", async () => {
    const user = {
      id: "u1",
      email: "user@example.com",
      username: "user",
      name: "User",
      passwordHash: validPasswordHash,
      status: "ACTIVE",
      role: { id: 1, name: "USER" },
      permissions: ["USERS.VIEW"],
    };
    getUser.mockResolvedValue(user);
    createUserSession.mockResolvedValue({ id: "session-1" });
    saveRefreshToken.mockResolvedValue({ id: "token-1" });

    const res = await authRoute.request(
      "/login",
      json({ identifier: "user@example.com", password: validPassword }),
    );
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.error).toBeNull();
    expect((body.data as { user: { email: string } }).user.email).toBe(
      "user@example.com",
    );
    expect(getUser).toHaveBeenCalledWith({ identifier: "user@example.com" });
  });

  it("returns 400 VALIDATION_ERROR when body is invalid", async () => {
    const res = await authRoute.request("/login", json({}));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 INVALID_CREDENTIALS when user is not found", async () => {
    getUser.mockResolvedValue(null);

    const res = await authRoute.request(
      "/login",
      json({ identifier: "user@example.com", password: "WrongPassword1!" }),
    );
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(401);
    expect(body.error?.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 429 TOO_MANY_ATTEMPTS when rate limit is exceeded", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    getUser.mockResolvedValue(null);

    const res = await authRoute.request(
      "/login",
      json({ identifier: "user@example.com", password: "any" }),
    );
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(429);
    expect(body.error?.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("returns 403 ACCOUNT_INACTIVE when user status is not ACTIVE", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      username: "user",
      name: "User",
      passwordHash: validPasswordHash,
      status: "INACTIVE",
      role: { id: 1, name: "USER" },
      permissions: ["USERS.VIEW"],
    });

    const res = await authRoute.request(
      "/login",
      json({ identifier: "user@example.com", password: validPassword }),
    );
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("ACCOUNT_INACTIVE");
  });
});

describe("POST /auth/register", () => {
  it("creates a user and returns 201", async () => {
    createUser.mockResolvedValue({
      id: "u2",
      email: "new@example.com",
      name: "New User",
      phone: "628123456789",
      username: "newuser",
      roleId: 1,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    });

    const res = await authRoute.request(
      "/register",
      json({
        email: "new@example.com",
        name: "New User",
        username: "newuser",
        password: validPassword,
        phone: "08123456789",
      }),
    );
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(201);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.error).toBeNull();
    expect((body.data as { email: string }).email).toBe("new@example.com");
  });

  it("returns 400 VALIDATION_ERROR for weak password", async () => {
    const res = await authRoute.request(
      "/register",
      json({
        email: "new@example.com",
        name: "New User",
        username: "newuser",
        password: "short",
        phone: "08123456789",
      }),
    );
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(body.error?.fields?.password).toBeDefined();
  });
});

describe("POST /auth/refresh", () => {
  it("rotates refresh token and returns new tokens", async () => {
    const { token: refreshToken } = await generateRefreshToken({
      id: "u1",
      email: "u@example.com",
      role: "USER",
    });
    rotateRefreshToken.mockResolvedValue({ id: "rotated-1" });

    const res = await authRoute.request("/refresh", json({ refreshToken }));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect((body.data as { accessToken: string }).accessToken).toBeDefined();
    expect((body.data as { refreshToken: string }).refreshToken).toBeDefined();
  });

  it("returns 401 REFRESH_TOKEN_REVOKED when rotation fails", async () => {
    const { token: refreshToken } = await generateRefreshToken({
      id: "u1",
      email: "u@example.com",
      role: "USER",
    });
    rotateRefreshToken.mockResolvedValue(null);

    const res = await authRoute.request("/refresh", json({ refreshToken }));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(401);
    expect(body.error?.code).toBe("REFRESH_TOKEN_REVOKED");
  });

  it("returns 400 VALIDATION_ERROR when refresh token is missing", async () => {
    const res = await authRoute.request("/refresh", json({}));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /auth/logout", () => {
  it("revokes the refresh token", async () => {
    const { token: refreshToken } = await generateRefreshToken({
      id: "u1",
      email: "u@example.com",
      role: "USER",
    });

    const res = await authRoute.request("/logout", json({ refreshToken }));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(revokeRefreshToken).toHaveBeenCalledWith(refreshToken);
  });

  it("returns 400 VALIDATION_ERROR when refresh token is missing", async () => {
    const res = await authRoute.request("/logout", json({}));
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /auth/logout-all", () => {
  it("revokes all sessions", async () => {
    const res = await authRoute.request("/logout-all", { method: "POST" });
    const body = (await res.json()) as ApiEnvelope;

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(revokeAllUserSessions).toHaveBeenCalled();
  });
});
