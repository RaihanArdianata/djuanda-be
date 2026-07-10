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
    })
    .from(users);
}

// Login bisa pakai email, nomor telepon, ATAU username -- cocokkan identifier yang sama
// ke ketiga kolom itu sekaligus.
export async function getUser({
  identifier,
}: {
  identifier: string;
}): Promise<GetUserType | null> {
  const phoneFormatted = await transformPhoneNumber(identifier);

  const user = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
      username: users.username,
      createdAt: users.createdAt,
      roles: userRoles.name,
      passwordHash: credentials.passwordHash,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .innerJoin(credentials, eq(credentials.userId, users.id))
    .where(
      or(
        eq(users.email, identifier.toLowerCase()),
        eq(users.phone, phoneFormatted),
        eq(users.username, identifier),
      ),
    )
    .limit(1);

  return user.length ? user[0] : null;
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
      .where(eq(userRoles.name, "USER"))
      .limit(1);

    if (!role) throw new Error("Role 'USER' tidak ditemukan");

    const passwordHashed = await bcryptHash(data.password);
    const phoneFormatted = await transformPhoneNumber(data.phone);

    const [user] = await tx
      .insert(users)
      .values({
        email: data.email.toLowerCase(),
        firstName: data.firstName,
        lastName: data.lastName,
        phone: phoneFormatted,
        username: data.username,
        isPlatformOwner: data.isPlatformOwner ?? false,
        roleId: data.isPlatformOwner ? null : role.id,
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
      firstName: users.firstName,
      lastName: users.lastName,
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

export async function saveRefreshToken(
  userId: string,
  token: string,
  expiresAt: Date,
): Promise<AuthTokenType> {
  const [inserted] = await db
    .insert(authTokens)
    .values({
      userId: userId,
      token: sha256Hash(token),
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
  return await db.transaction(async (tx) => {
    const [deactivated] = await tx
      .update(authTokens)
      .set({ isActive: false, usedAt: new Date() })
      .where(
        and(
          eq(authTokens.token, sha256Hash(oldToken)),
          eq(authTokens.isActive, true),
        ),
      )
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

export async function revokeRefreshToken(
  token: string,
): Promise<QueryResult<never>> {
  return await db
    .update(authTokens)
    .set({ isActive: false, usedAt: new Date() })
    .where(eq(authTokens.token, sha256Hash(token)));
}
