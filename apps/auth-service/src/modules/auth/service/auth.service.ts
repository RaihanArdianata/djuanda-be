import {
  authTokens,
  type CreateUserProfileInput,
  type CreateUserSessionInput,
  credentials,
  db,
  type UserWithPermissionsType,
  userPermissionsQueryConfig,
  userRoles,
  userSessions,
  users,
} from "@repo/database";
import { logger } from "@repo/logger";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { transformPhoneNumber } from "@repo/shared";
import { bcryptHash, sha256Hash } from "@repo/shared";
import { verifyToken } from "@/utils/jwt";

type UserType = typeof users.$inferSelect;
type AuthTokensType = typeof authTokens.$inferSelect;
type UserSessionType = typeof userSessions.$inferSelect;
type GetUsersType = Omit<UserType, "deletedAt" | "roleId" | "status">;

export async function getUsers(): Promise<GetUsersType[]> {
  return await db
    .select({
      name: users.name,
      id: users.id,
      email: users.email,
      phone: users.phone,
      username: users.username,
      createdAt: users.createdAt,
    })
    .from(users);
}

// Login bisa pakai email, nomor telepon, ATAU username -- cocokkan identifier yang sama
// ke ketiga kolom itu sekaligus.
// export type GetUserType = NonNullable<Awaited<ReturnType<typeof getUser>>>;
type GetUserType = UserWithPermissionsType & {
  permissions: string[];
  passwordHash?: string;
};

export async function getUser({ identifier }: { identifier: string }): Promise<GetUserType | null> {
  const user = await db.query.users.findFirst({
    where: or(eq(users.email, identifier.toLowerCase()), eq(users.username, identifier)),
    ...userPermissionsQueryConfig,
  });

  if (!user) return null;

  return {
    ...user,
    permissions: user.role?.rolePermissions.map((rp) => rp.permission.code) || [],
    passwordHash: user.credentials?.passwordHash || "",
  };
}

export type RegisterUserInput = Omit<CreateUserProfileInput, "id" | "createdAt" | "deletedAt" | "roleId"> & { password: string };

export async function createUser(data: RegisterUserInput): Promise<UserType> {
  return await db.transaction(async (tx) => {
    const [role] = await tx.select().from(userRoles).where(eq(userRoles.name, "USER")).limit(1);

    if (!role) throw new Error("Role 'USER' tidak ditemukan");

    const passwordHashed = await bcryptHash(data.password);
    const phoneFormatted = transformPhoneNumber(data.phone);

    const [user] = await tx
      .insert(users)
      .values({
        email: data.email.toLowerCase(),
        name: data.name,
        phone: phoneFormatted,
        username: data.username,
        roleId: role.id,
      })
      .returning();

    await tx.insert(credentials).values({
      userId: user.id,
      passwordHash: passwordHashed,
    });

    return user;
  });
}

export async function getUserById(id: string): Promise<GetUserType | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
    ...userPermissionsQueryConfig,
  });

  if (!user) return null;

  return {
    ...user,
    passwordHash: undefined,
    permissions: user.role?.rolePermissions.map((rp) => rp.permission.code) || [],
  };
}

export async function saveRefreshToken(userId: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<AuthTokensType> {
  const tokenHash = `${sha256Hash(accessToken)}:${sha256Hash(refreshToken)}`;

  const [inserted] = await db
    .insert(authTokens)
    .values({
      userId: userId,
      token: tokenHash,
      type: "refresh_token",
      createdAt: new Date(),
      expiresAt: expiresAt,
    })
    .returning();

  return inserted;
}

// Rotasi refresh token: nonaktifkan token lama (kalau masih aktif) dan simpan token baru dalam satu transaksi.
// Return null kalau token lama sudah tidak aktif (sudah dipakai sebelumnya / direvoke) -> indikasi reuse/replay.
export async function rotateRefreshToken({
  oldRefreshToken,
  userId,
  newRefreshToken,
  newAccessToken,
  expiresAt,
}: {
  oldRefreshToken: string;
  newRefreshToken: string;
  newAccessToken: string;
  userId: string;
  expiresAt: Date;
}): Promise<AuthTokensType | null> {
  const oldTokenHash = sha256Hash(oldRefreshToken);
  const newTokenHash = `${sha256Hash(newAccessToken)}:${sha256Hash(newRefreshToken)}`;

  return await db.transaction(async (tx) => {
    const [deactivated] = await tx
      .update(authTokens)
      .set({ isActive: false, usedAt: new Date() })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.isActive, true), gt(authTokens.expiresAt, new Date()), sql`RIGHT(token, LENGTH(${oldTokenHash})) = ${oldTokenHash}`))
      .returning();

    if (!deactivated) return null;

    const [inserted] = await tx
      .insert(authTokens)
      .values({
        userId,
        token: newTokenHash,
        type: "refresh_token",
        expiresAt,
      })
      .returning();

    if (!inserted) return null;

    const [session] = await tx
      .update(userSessions)
      .set({ refreshTokenHash: sha256Hash(newRefreshToken), expiresAt })
      .where(and(eq(userSessions.userId, userId), eq(userSessions.refreshTokenHash, sha256Hash(oldRefreshToken))))
      .returning();

    if (!session) return null;

    return inserted;
  });
}

export async function revokeRefreshToken(token: string, isPlain = true): Promise<void> {
  await db
    .update(authTokens)
    .set({ isActive: false, usedAt: new Date() })
    .where(eq(authTokens.token, isPlain ? sha256Hash(token) : token));

  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.refreshTokenHash, isPlain ? sha256Hash(token) : token));
}

export async function getUserSession(userId: string): Promise<{ isLoggedIn: boolean; session: UserSessionType | null }> {
  const activeSession = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date())))
    .limit(1);

  return {
    isLoggedIn: activeSession.length > 0,
    session: activeSession.length > 0 ? activeSession[0] : null,
  };
}

export async function createUserSession(data: Omit<CreateUserSessionInput, "id" | "createdAt">): Promise<UserSessionType> {
  const existingSession = await getUserSession(data.userId);
  logger.debug(
    `Existing session for user ${data.userId}: ${existingSession.isLoggedIn ? "active" : "none"} session found ${existingSession.isLoggedIn ? `with ID ${existingSession.session?.id}` : ""}`
  );
  if (existingSession.isLoggedIn && existingSession.session) {
    logger.debug(`Revoking existing session for user ${data.userId}, token: ${existingSession.session?.refreshTokenHash}`);
    await revokeRefreshToken(existingSession.session?.refreshTokenHash, false);
  }

  const [result] = await db.insert(userSessions).values(data).returning();
  return result;
}

export async function revokeAllUserSessions(): Promise<void> {
  await db.update(userSessions).set({ revokedAt: new Date() });
  await db.update(authTokens).set({ isActive: false, usedAt: new Date() });
}

export async function isAccessTokenValid(userId: string, token: string): Promise<boolean> {
  const existingToken = await db.query.authTokens.findFirst({
    where: and(eq(authTokens.userId, userId), eq(authTokens.isActive, true), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())),
  });

  if (!existingToken) {
    logger.debug(`No active token found for user ${userId}. Token: ${token}`);
    return false;
  }

  const [accessTokenHash, refreshTokenHash] = existingToken.token.split(":");

  if (!accessTokenHash || !refreshTokenHash) {
    logger.warn(`Invalid token format for user ${userId}. Token: ${existingToken.token}`);
    return false;
  }

  const isJwtValid = await verifyToken(token);

  if (!isJwtValid) {
    logger.debug(`JWT verification failed for user ${userId}. Token: ${token}`);
    return false;
  }
  const isValid = accessTokenHash === sha256Hash(token);

  if (!isValid) {
    logger.debug(`Access token mismatch for user ${userId}. Provided: ${sha256Hash(token)}, Expected: ${accessTokenHash}`);
  }

  return isValid;
}
