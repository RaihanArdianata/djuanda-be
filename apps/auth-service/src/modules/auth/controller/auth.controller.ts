<<<<<<< HEAD
import { loginRateLimitConfig } from "@repo/config";
import {
  ApiError,
  catchAsync,
  checkRateLimit,
  resetRateLimit,
  success,
} from "@repo/shared";
import * as HttpStatus from "http-status";
import { bcryptHash, bcryptVerify } from "@/utils/hashing";
import { generateRefreshToken, generateToken, verifyToken } from "@/utils/jwt";
import {
  createUser,
  getUser,
  revokeRefreshToken,
  rotateRefreshToken,
  saveRefreshToken,
} from "../service/auth.service";
import type {
  loginSchemaType,
  refreshTokenSchemaType,
  registerSchemaType,
} from "../validator/auth.validator";
=======
import { createUser, getUser, saveRefreshToken, rotateRefreshToken, revokeRefreshToken, createUserSession, getUserSession } from '../service/auth.service';
import { catchAsync, success, ApiError } from '@repo/shared';
import { loginSchemaType, registerSchemaType, refreshTokenSchemaType } from '../validator/auth.validator';
import { bcryptHash, bcryptVerify, sha256Hash } from '@/utils/hashing';
import { checkRateLimit, resetRateLimit } from '@repo/shared';
import { loginRateLimitConfig } from '@repo/config';
import { generateToken, generateRefreshToken, verifyToken } from '@/utils/jwt';
import * as HttpStatus from 'http-status';
import { logger } from '@repo/logger';
import { getConnInfo } from 'hono/bun';
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0

const dummyPasswordHash = bcryptHash('dummy-password-for-timing-safety');

export const register = catchAsync(async (c) => {
<<<<<<< HEAD
  const { email, firstName, lastName, password, phone, username } = c.get('parsedData') as registerSchemaType;
=======
  const { email, name, password, phone, username }: registerSchemaType = await c.req.parseBody();
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0

  const result = await createUser({
    email,
    name,
    password,
    phone,
    username,
  });

<<<<<<< HEAD
  return success(c, result, {
    code: HttpStatus.default.CREATED,
    message: "User registered successfully",
  });
});

export const login = catchAsync(async (c) => {
  const { password, username } = c.get('parsedData') as loginSchemaType;
=======
  return success(c, result, { code: HttpStatus.default.CREATED, message: 'User registered successfully' });
});

export const login = catchAsync(async (c) => {
  const { password, identifier }: loginSchemaType = await c.req.parseBody();
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0

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

  const verifiedPassword = await bcryptVerify(password, findUser.passwordHash);
  if (!verifiedPassword) {
    throw new ApiError("INVALID_CREDENTIALS");
  }

  const isUserActive = findUser.status === 'ACTIVE';
  if (!isUserActive) {
    throw new ApiError('ACCOUNT_INACTIVE');
  }

  await resetRateLimit(rateLimitKey);

  const payload = {
    id: findUser.id,
    email: findUser.email,
<<<<<<< HEAD
    roles: findUser.roles || "",
=======
    role: findUser.role?.name || '',
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
  };

  const accessToken = await generateToken(payload);
  const { token, tmpExp } = await generateRefreshToken(payload);

  await saveRefreshToken(findUser.id, token, new Date(tmpExp * 1000));

<<<<<<< HEAD
  return success(
    c,
    {
      firstName: findUser.firstName,
      lastName: findUser.lastName,
      email: findUser.email,
      roles: payload.roles,
      authorization: {
        token: accessToken,
        refreshToken: token,
      },
    },
    { message: "Login successful" },
=======
  const existingSession = await getUserSession(findUser.id);

  if (existingSession.isLoggedIn) {
    throw new ApiError('SESSION_TERMINATED', { message: 'You are already logged in from another device. Please logout from that device first.' });
  }

  const [newSession] = await createUserSession({
    expiresAt: new Date(tmpExp * 1000),
    refreshTokenHash: sha256Hash(token),
    userId: findUser.id,
    deviceInfo: c.req.header('User-Agent') || '',
    ipAddress:
      c.req.header('X-Forwarded-For') || c.req.header('CF-Connecting-IP') || c.req.header('True-Client-IP') || c.req.header('X-Real-IP') || getConnInfo(c).remote.address || '',
  });

  logger.debug(`User ${findUser.id} logged in. Session ID: ${newSession.id}, IP: ${newSession.ipAddress}, Device: ${newSession.deviceInfo}`);

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
      role: findUser.role?.name || '',
      permissions: findUser.permissions || [],
    },
    { message: 'Login successful' }
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
  );
});

export const refreshToken = catchAsync(async (c) => {
  const { refreshToken }: refreshTokenSchemaType = await c.req.json();

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
    expiresAt: new Date(tmpExp),
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
<<<<<<< HEAD
    { message: "Token refreshed successfully" },
=======
    { message: 'Token refreshed successfully' }
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
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

  return success(c, null, { message: 'Logout successful' });
});
