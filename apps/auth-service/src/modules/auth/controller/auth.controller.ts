import { loginRateLimitConfig } from "@repo/config";
import { logger } from "@repo/logger";
import {
  ApiError,
  catchAsync,
  checkRateLimit,
  resetRateLimit,
  success,
} from "@repo/shared";
import { getConnInfo } from "hono/bun";
import * as HttpStatus from "http-status";
import { bcryptHash, bcryptVerify, sha256Hash } from "@/utils/hashing";
import { generateRefreshToken, generateToken, verifyToken } from "@/utils/jwt";
import {
  createUser,
  createUserSession,
  getUser,
  getUserSession,
  revokeAllUserSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  saveRefreshToken,
} from "../service/auth.service";
import type {
  loginSchemaType,
  refreshTokenSchemaType,
  registerSchemaType,
} from "../validator/auth.validator";

const dummyPasswordHash = bcryptHash("dummy-password-for-timing-safety");

export const register = catchAsync(async (c) => {
  const { email, name, password, phone, username } = c.get(
    "parsedData",
  ) as registerSchemaType;

  const result = await createUser({
    email,
    name,
    password,
    phone,
    username,
  });

  return success(c, result, {
    code: HttpStatus.default.CREATED,
    message: "User registered successfully",
  });
});

export const login = catchAsync(async (c) => {
  const { password, identifier } = c.get("parsedData") as loginSchemaType;

  const rateLimitKey = `login:${identifier.toLowerCase()}`;
  const { allowed } = await checkRateLimit({
    key: rateLimitKey,
    limit: loginRateLimitConfig.maxAttempts,
    windowSeconds: loginRateLimitConfig.windowSeconds,
  });

  if (!allowed) {
    throw new ApiError("TOO_MANY_ATTEMPTS");
  }

  const findUser = await getUser({ identifier });

  if (!findUser) {
    await bcryptVerify(password, await dummyPasswordHash);
    throw new ApiError("INVALID_CREDENTIALS");
  }

  const verifiedPassword = await bcryptVerify(
    password,
    findUser.passwordHash as string,
  );
  if (!verifiedPassword) {
    throw new ApiError("INVALID_CREDENTIALS");
  }

  const isUserActive = findUser.status === "ACTIVE";
  if (!isUserActive) {
    throw new ApiError("ACCOUNT_INACTIVE");
  }

  await resetRateLimit(rateLimitKey);

  const payload = {
    id: findUser.id,
    email: findUser.email,
    role: findUser.role?.name || "",
  };

  const accessToken = await generateToken(payload);
  const { token, tmpExp } = await generateRefreshToken(payload);

  await saveRefreshToken(findUser.id, token, new Date(tmpExp * 1000));

  const existingSession = await getUserSession(findUser.id);

  if (existingSession.isLoggedIn) {
    throw new ApiError("SESSION_TERMINATED", {
      message:
        "You are already logged in from another device. Please logout from that device first.",
    });
  }

  const newSession = await createUserSession({
    expiresAt: new Date(tmpExp * 1000),
    refreshTokenHash: sha256Hash(token),
    userId: findUser.id,
    deviceInfo: c.req.header("User-Agent") || "",
    ipAddress:
      c.req.header("X-Forwarded-For") ||
      c.req.header("CF-Connecting-IP") ||
      c.req.header("True-Client-IP") ||
      c.req.header("X-Real-IP") ||
      getConnInfo(c).remote.address ||
      "",
  });

  logger.debug(
    `User ${findUser.id} logged in. Session ID: ${newSession.id}, IP: ${newSession.ipAddress}, Device: ${newSession.deviceInfo}`,
  );

  return success(
    c,
    {
      accessToken,
      refreshToken: token,
      user: {
        id: findUser.id,
        username: findUser.username,
        email: findUser.email,
        name: findUser.name,
      },
      role: findUser.role?.name || "",
      permissions: findUser.permissions || [],
    },
    { message: "Login successful" },
  );
});

export const refreshToken = catchAsync(async (c) => {
  const { refreshToken }: refreshTokenSchemaType = c.get(
    "parsedData",
  ) as refreshTokenSchemaType;

  if (!refreshToken) {
    throw new ApiError("REFRESH_TOKEN_REQUIRED");
  }

  const decoded = await verifyToken(refreshToken);
  if (!decoded) {
    throw new ApiError("INVALID_REFRESH_TOKEN");
  }

  const payload = {
    id: decoded.id as string,
    email: decoded.email as string,
    role: decoded.role as string,
  };

  const newAccessToken = await generateToken(payload);
  const { token: newRefreshToken, tmpExp } =
    await generateRefreshToken(payload);

  const rotated = await rotateRefreshToken({
    oldToken: refreshToken,
    userId: payload.id,
    newToken: newRefreshToken,
    expiresAt: new Date(tmpExp * 1000),
  });

  if (!rotated) {
    throw new ApiError("REFRESH_TOKEN_REVOKED");
  }

  return success(
    c,
    {
      token: newAccessToken,
      refreshToken: newRefreshToken,
    },
    { message: "Token refreshed successfully" },
  );
});

export const logout = catchAsync(async (c) => {
  const { refreshToken }: refreshTokenSchemaType = await c.req.json();

  if (!refreshToken) {
    throw new ApiError("REFRESH_TOKEN_REQUIRED");
  }

  const decoded = await verifyToken(refreshToken);
  if (!decoded) {
    throw new ApiError("INVALID_REFRESH_TOKEN");
  }

  await revokeRefreshToken(refreshToken);

  return success(c, null, { message: "Logout successful" });
});

export const logoutAllSessions = catchAsync(async (c) => {
  await revokeAllUserSessions();

  return success(c, null, { message: "All sessions logged out successfully" });
});
