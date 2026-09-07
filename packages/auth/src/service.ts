import {
  authTokens,
  db,
  userPermissionsQueryConfig,
  users,
} from "@repo/database";
import { logger } from "@repo/logger";
import { sha256Hash } from "@repo/shared/utils/hashing";
import { and, eq, gt, isNull } from "drizzle-orm";
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
