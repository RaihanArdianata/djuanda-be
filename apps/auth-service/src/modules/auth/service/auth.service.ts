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
    })
    .from(users);
}

// Login bisa pakai email, nomor telepon, ATAU username -- cocokkan identifier yang sama
// ke ketiga kolom itu sekaligus.
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

  if (!user) return null;

  return {
    ...user,
    permissions: user.role?.rolePermissions.map((rp) => rp.permission.name) || [],
    passwordHash: user.credentials?.passwordHash || '',
  };
}

export type RegisterUserInput = Omit<CreateUserProfileInput, 'id' | 'createdAt' | 'deletedAt' | 'roleId'> & { password: string };

export async function createUser(data: RegisterUserInput) {
  return await db.transaction(async (tx) => {
    const [role] = await tx.select().from(userRoles).where(eq(userRoles.name, 'USER')).limit(1);

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

export async function getUserById(id: string) {
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

export async function saveRefreshToken(userId: string, token: string, expiresAt: Date) {
  const [inserted] = await db
    .insert(authTokens)
    .values({
      userId: userId,
      token: sha256Hash(token),
      type: 'refresh_token',
      createdAt: new Date(),
      expiresAt: expiresAt,
    })
    .returning();

  return inserted;
}

// Rotasi refresh token: nonaktifkan token lama (kalau masih aktif) dan simpan token baru dalam satu transaksi.
// Return null kalau token lama sudah tidak aktif (sudah dipakai sebelumnya / direvoke) -> indikasi reuse/replay.
export async function rotateRefreshToken({ oldToken, userId, newToken, expiresAt }: { oldToken: string; userId: string; newToken: string; expiresAt: Date }) {
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
        type: 'refresh_token',
        expiresAt,
      })
      .returning();

    return inserted;
  });
}

export async function revokeRefreshToken(token: string, isPlain: boolean = true) {
  await db
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
