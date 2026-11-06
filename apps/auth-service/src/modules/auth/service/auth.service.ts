import type { GetUserType } from "@repo/auth";
import {
  authTokens,
  type CreateUserProfileInput,
  type CreateUserSessionInput,
  credentials,
  db,
  userPermissionsQueryConfig,
  userRoles,
  userSessions,
  users,
} from "@repo/database";
import { logger } from "@repo/logger";
import { transformPhoneNumber } from "@repo/shared/utils/formatter";
import { bcryptHash, sha256Hash } from "@repo/shared/utils/hashing";
import { and, eq, gt, ilike, isNull, or } from "drizzle-orm";

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
// GetUserType now lives in @repo/auth.

export async function getUser({
  identifier,
}: {
  identifier: string;
}): Promise<GetUserType | null> {
  const user = await db.query.users.findFirst({
    where: or(
      eq(users.email, identifier.toLowerCase()),
      eq(users.username, identifier),
    ),
    ...userPermissionsQueryConfig,
  });

  if (!user) return null;

  return {
    ...user,
    permissions:
      user.role?.rolePermissions.map((rp) => rp.permission.code) || [],
    passwordHash: user.credentials?.passwordHash || "",
  };
}

export type RegisterUserInput = Omit<
  CreateUserProfileInput,
  "id" | "createdAt" | "deletedAt" | "roleId"
> & { password: string };

export async function createUser(data: RegisterUserInput): Promise<UserType> {
  return await db.transaction(async (tx) => {
    const [role] = await tx
      .select()
      .from(userRoles)
      .where(ilike(userRoles.name, "USER"))
      .limit(1);

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

export async function saveRefreshToken(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
): Promise<AuthTokensType> {
  const [inserted] = await db
    .insert(authTokens)
    .values({
      userId: userId,
      token: sha256Hash(accessToken),
      refreshToken: sha256Hash(refreshToken),
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
  const newTokenHash = sha256Hash(newAccessToken);
  const newRefreshTokenHash = sha256Hash(newRefreshToken);

  return await db.transaction(async (tx) => {
    const [deactivated] = await tx
      .update(authTokens)
      .set({ isActive: false, usedAt: new Date() })
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.isActive, true),
          gt(authTokens.expiresAt, new Date()),
          eq(authTokens.refreshToken, oldTokenHash),
        ),
      )
      .returning();

    if (!deactivated) return null;

    const [inserted] = await tx
      .insert(authTokens)
      .values({
        userId,
        token: newTokenHash,
        refreshToken: newRefreshTokenHash,
        type: "refresh_token",
        expiresAt,
      })
      .returning();

    if (!inserted) return null;

    const [session] = await tx
      .update(userSessions)
      .set({ refreshTokenHash: newRefreshTokenHash, expiresAt })
      .where(
        and(
          eq(userSessions.userId, userId),
          eq(userSessions.refreshTokenHash, oldTokenHash),
        ),
      )
      .returning();

    if (!session) return null;

    return inserted;
  });
}

export async function revokeRefreshToken(
  token: string,
  isPlain = true,
): Promise<void> {
  const refreshTokenHash = isPlain ? sha256Hash(token) : token;

  await db
    .update(authTokens)
    .set({ isActive: false, usedAt: new Date() })
    .where(
      and(
        eq(authTokens.isActive, true),
        gt(authTokens.expiresAt, new Date()),
        eq(authTokens.refreshToken, refreshTokenHash),
      ),
    );

  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.refreshTokenHash, refreshTokenHash));
}

export async function getUserSession(
  userId: string,
): Promise<{ isLoggedIn: boolean; session: UserSessionType | null }> {
  const activeSession = await db
    .select()
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return {
    isLoggedIn: activeSession.length > 0,
    session: activeSession.length > 0 ? activeSession[0] : null,
  };
}

export async function createUserSession(
  data: Omit<CreateUserSessionInput, "id" | "createdAt">,
  options: { allowConcurrent?: boolean } = {},
): Promise<UserSessionType> {
  if (options.allowConcurrent) {
    const [result] = await db.insert(userSessions).values(data).returning();
    return result;
  }

  const existingSession = await getUserSession(data.userId);
  logger.debug(
    `Existing session for user ${data.userId}: ${existingSession.isLoggedIn ? "active" : "none"} session found ${existingSession.isLoggedIn ? `with ID ${existingSession.session?.id}` : ""}`,
  );
  if (existingSession.isLoggedIn && existingSession.session) {
    logger.debug(
      `Revoking existing session for user ${data.userId}, token: ${existingSession.session?.refreshTokenHash}`,
    );
    await revokeRefreshToken(existingSession.session?.refreshTokenHash, false);
  }

  const [result] = await db.insert(userSessions).values(data).returning();
  return result;
}

export async function revokeAllUserSessions(): Promise<void> {
  await db.update(userSessions).set({ revokedAt: new Date() });
  await db.update(authTokens).set({ isActive: false, usedAt: new Date() });
}
