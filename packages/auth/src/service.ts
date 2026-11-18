import {
  authTokens,
  db,
  userPermissionsQueryConfig,
  userSessions,
  users,
} from "@repo/database";
import { logger } from "@repo/logger";
import { sha256Hash } from "@repo/shared/utils/hashing";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { verifyToken } from "./jwt";
import type { GetUserType } from "./types";

export async function getUserById(id: string): Promise<GetUserType | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
    ...userPermissionsQueryConfig,
  });

  if (!user) return null;

  return {
    ...user,
    passwordHash: undefined,
    permissions:
      user.role?.rolePermissions.map((rp) => rp.permission.code) || [],
  };
}

export async function validateAccessToken(
  userId: string,
  token: string,
): Promise<{
  isValid: boolean;
  isExpired: boolean;
}> {
  const isJwtValid = await verifyToken(token);

  if (!isJwtValid) {
    logger.debug({ userId }, "JWT verification failed");
    return {
      isValid: false,
      isExpired: true,
    };
  }

  const accessTokenHash = sha256Hash(token);

  const existingToken = await db.query.authTokens.findFirst({
    where: and(
      eq(authTokens.userId, userId),
      eq(authTokens.isActive, true),
      isNull(authTokens.usedAt),
      gt(authTokens.expiresAt, new Date()),
      eq(authTokens.token, accessTokenHash),
    ),
  });

  if (!existingToken) {
    logger.debug({ userId }, "No active token found");
    return {
      isValid: false,
      isExpired: false,
    };
  }

  return {
    isValid: true,
    isExpired: false,
  };
}

/** Sesi aktif terbaru pengguna: dialah yang menggantikan sesi lama yang diputus oleh login di perangkat lain. */
export async function getReplacingSession(userId: string): Promise<{
  deviceInfo: string | null;
  ipAddress: string | null;
  createdAt: Date | null;
} | null> {
  const [row] = await db
    .select({
      deviceInfo: userSessions.deviceInfo,
      ipAddress: userSessions.ipAddress,
      createdAt: userSessions.createdAt,
    })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(userSessions.createdAt))
    .limit(1);
  return row ?? null;
}
