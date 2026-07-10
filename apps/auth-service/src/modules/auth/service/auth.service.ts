<<<<<<< HEAD
import {
  authTokens,
  type CreateUserProfileInput,
  credentials,
  db,
  userRoles,
  users,
} from "@repo/database";
import { and, eq, or } from "drizzle-orm";
import type { QueryResult } from "pg";
import { transformPhoneNumber } from "@/utils/formater";
import { bcryptHash, sha256Hash } from "@/utils/hashing";

type UserType = typeof users.$inferSelect;
type AuthTokenType = typeof authTokens.$inferSelect;
type GetUserType = Omit<
  UserType,
  "deletedAt" | "roleId" | "isPlatformOwner"
> & { roles: string | null; passwordHash: string };
type GetUsersType = Omit<UserType, "deletedAt" | "roleId" | "isPlatformOwner">;

export async function getUsers(): Promise<GetUsersType[]> {
  return await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
      username: users.username,
      createdAt: users.createdAt,
=======
import { db, users, credentials, authTokens, userRoles, CreateUserProfileInput, rolePermissions, permissions, userSessions, CreateUserSessionInput } from '@repo/database';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { bcryptHash, sha256Hash } from '@/utils/hashing';
import { transformPhoneNumber } from '@/utils/formater';
import { logger } from '@repo/logger';

export async function getUsers() {
  return await db
    .select({
      id: users.id,
      createdAt: users.createdAt,
      email: users.email,
      name: users.name,
      phone: users.phone,
      username: users.username,
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
    })
    .from(users);
}

// Login bisa pakai email, nomor telepon, ATAU username -- cocokkan identifier yang sama
// ke ketiga kolom itu sekaligus.
<<<<<<< HEAD
export async function getUser({
  identifier,
}: {
  identifier: string;
}): Promise<GetUserType | null> {
  const phoneFormatted = await transformPhoneNumber(identifier);
=======
export async function getUser({ identifier }: { identifier: string }) {
  const user = await db.query.users.findFirst({
    where: (users, { eq, or }) => or(eq(users.email, identifier.toLowerCase()), eq(users.username, identifier)),
    with: {
      role: {
        with: {
          rolePermissions: {
            with: { permission: true },
          },
        },
      },
      credentials: true,
    },
  });
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0

  if (!user) return null;

  return {
    ...user,
    permissions: user.role?.rolePermissions.map((rp) => rp.permission.name) || [],
    passwordHash: user.credentials?.passwordHash || '',
  };
}

<<<<<<< HEAD
export type RegisterUserInput = Omit<
  CreateUserProfileInput,
  "id" | "createdAt" | "deletedAt" | "roleId"
> & { password: string };
=======
export type RegisterUserInput = Omit<CreateUserProfileInput, 'id' | 'createdAt' | 'deletedAt' | 'roleId'> & { password: string };
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0

export async function createUser(data: RegisterUserInput): Promise<UserType> {
  return await db.transaction(async (tx) => {
<<<<<<< HEAD
    const [role] = await tx
      .select()
      .from(userRoles)
      .where(eq(userRoles.name, "USER"))
      .limit(1);
=======
    const [role] = await tx.select().from(userRoles).where(eq(userRoles.name, 'USER')).limit(1);
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0

    if (!role) throw new Error("Role 'USER' tidak ditemukan");

    const passwordHashed = await bcryptHash(data.password);
    const phoneFormatted = await transformPhoneNumber(data.phone);

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

type GetUserByIdType = Omit<GetUserType, "passwordHash">;
export async function getUserById(id: string): Promise<GetUserByIdType | null> {
  const user = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      phone: users.phone,
      username: users.username,
      createdAt: users.createdAt,
      roles: userRoles.name,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .where(eq(users.id, id))
    .limit(1);

  return user.length ? user[0] : null;
}

<<<<<<< HEAD
export async function saveRefreshToken(
  userId: string,
  token: string,
  expiresAt: Date,
): Promise<AuthTokenType> {
=======
export async function saveRefreshToken(userId: string, token: string, expiresAt: Date) {
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
  const [inserted] = await db
    .insert(authTokens)
    .values({
      userId: userId,
      token: sha256Hash(token),
<<<<<<< HEAD
      type: "refresh_token",
=======
      type: 'refresh_token',
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
      createdAt: new Date(),
      expiresAt: expiresAt,
    })
    .returning();

  return inserted;
}

// Rotasi refresh token: nonaktifkan token lama (kalau masih aktif) dan simpan token baru dalam satu transaksi.
// Return null kalau token lama sudah tidak aktif (sudah dipakai sebelumnya / direvoke) -> indikasi reuse/replay.
<<<<<<< HEAD
export async function rotateRefreshToken({
  oldToken,
  userId,
  newToken,
  expiresAt,
}: {
  oldToken: string;
  userId: string;
  newToken: string;
  expiresAt: Date;
}): Promise<AuthTokenType | null> {
=======
export async function rotateRefreshToken({ oldToken, userId, newToken, expiresAt }: { oldToken: string; userId: string; newToken: string; expiresAt: Date }) {
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
  return await db.transaction(async (tx) => {
    const [deactivated] = await tx
      .update(authTokens)
      .set({ isActive: false, usedAt: new Date() })
      .where(and(eq(authTokens.token, sha256Hash(oldToken)), eq(authTokens.isActive, true)))
      .returning();

    if (!deactivated) return null;

    const [inserted] = await tx
      .insert(authTokens)
      .values({
        userId,
        token: sha256Hash(newToken),
        type: "refresh_token",
        expiresAt,
      })
      .returning();

    return inserted;
  });
}

<<<<<<< HEAD
export async function revokeRefreshToken(
  token: string,
): Promise<QueryResult<never>> {
  return await db
=======
export async function revokeRefreshToken(token: string, isPlain: boolean = true) {
  await db
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
    .update(authTokens)
    .set({ isActive: false, usedAt: new Date() })
    .where(eq(authTokens.token, isPlain ? sha256Hash(token) : token));

  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.refreshTokenHash, isPlain ? sha256Hash(token) : token));
}

export async function getUserSession(userId: string) {
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

export async function createUserSession(data: Omit<CreateUserSessionInput, 'id' | 'createdAt'>) {
  const existingSession = await getUserSession(data.userId);
  logger.debug(
    `Existing session for user ${data.userId}: ${existingSession.isLoggedIn ? 'active' : 'none'} session found ${existingSession.isLoggedIn ? `with ID ${existingSession.session!.id}` : ''}`
  );
  if (existingSession.isLoggedIn) {
    logger.debug(`Revoking existing session for user ${data.userId}, token: ${existingSession.session!.refreshTokenHash}`);
    await revokeRefreshToken(existingSession.session!.refreshTokenHash, false);
  }
  return await db.insert(userSessions).values(data).returning();
}
