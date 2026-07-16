import { and, not, inArray, isNull, desc, ilike, eq, or } from "drizzle-orm";
import { credentials, db, userRoles, users } from "@repo/database";
import { ApiError, bcryptHash, transformPhoneNumber } from "@repo/shared";
import type { CreateUserParams, GetAllUsersParams, UpdateUserParams } from "../validator/user.validator";

export type UserType = Omit<typeof users.$inferSelect, "deletedAt" | "roleId"> & {
  role: {
    id: number;
    name: string;
  } | null;
  permissions: string[];
};

export async function getAllUsers(params: GetAllUsersParams): Promise<UserType[]> {
  const whereClause = [and(isNull(users.deletedAt), not(inArray(users.status, ["DELETED"])))];

  if (params.search) {
    const searchTerm = `%${params.search.toLowerCase()}%`;
    whereClause.push(and(ilike(users.name, searchTerm), ilike(users.email, searchTerm), ilike(users.username, searchTerm)));
  }

  if (params.role) {
    whereClause.push(eq(users.roleId, parseInt(params.role, 10)));
  }

  if (params.status) {
    whereClause.push(eq(users.status, params.status));
  }

  if (params.id) {
    whereClause.push(eq(users.id, params.id));
  }

  const page = parseInt(params.page, 10) || 1;
  const size = parseInt(params.size, 10) || 10;

  const allUsers = await db.query.users.findMany({
    where: whereClause.length > 0 ? and(...whereClause) : undefined,
    orderBy: desc(users.createdAt),
    with: {
      role: {
        with: {
          rolePermissions: {
            with: { permission: true },
          },
        },
      },
    },
    columns: {
      id: true,
      name: true,
      email: true,
      phone: true,
      username: true,
      status: true,
      createdAt: true,
    },
    limit: size,
    offset: (page - 1) * size,
  });

  const usersWithPermissions = allUsers.map((user) => ({
    ...user,
    role: user.role
      ? {
          id: user.role.id,
          name: user.role.name,
        }
      : null,
    permissions: user.role?.rolePermissions.map((rp) => rp.permission.code) || [],
  }));

  return usersWithPermissions;
}

export async function getCountUsers(params: GetAllUsersParams): Promise<number> {
  const whereClause = [and(isNull(users.deletedAt), not(inArray(users.status, ["DELETED"])))];
  if (params.search) {
    const searchTerm = `%${params.search.toLowerCase()}%`;
    whereClause.push(and(ilike(users.name, searchTerm), ilike(users.email, searchTerm), ilike(users.username, searchTerm)));
  }
  if (params.role) {
    whereClause.push(eq(users.roleId, parseInt(params.role, 10)));
  }
  if (params.status) {
    whereClause.push(eq(users.status, params.status));
  }
  if (params.id) {
    whereClause.push(eq(users.id, params.id));
  }
  const count = await db.$count(users, whereClause.length > 0 ? and(...whereClause) : undefined);
  return count;
}

export async function getUserById(id: string): Promise<UserType | null> {
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, id), isNull(users.deletedAt)),
    with: {
      role: {
        with: {
          rolePermissions: {
            with: { permission: true },
          },
        },
      },
    },
    columns: {
      id: true,
      name: true,
      email: true,
      phone: true,
      username: true,
      status: true,
      createdAt: true,
    },
  });

  if (!user) return null;

  return {
    ...user,
    role: user.role
      ? {
          id: user.role.id,
          name: user.role.name,
        }
      : null,
    permissions: user.role?.rolePermissions.map((rp) => rp.permission.code) || [],
  };
}

export async function createUser(data: CreateUserParams): Promise<UserType> {
  return await db.transaction(async (tx) => {
    const [existingUser] = await tx
      .select()
      .from(users)
      .where(or(eq(users.email, data.email.toLowerCase()), eq(users.username, data.username)))
      .limit(1);

    if (existingUser) {
      throw new ApiError("BAD_REQUEST", { message: "User with the same email or username already exists." });
    }

    const [role] = await tx.select().from(userRoles).where(eq(userRoles.id, data.role)).limit(1);

    if (!role) throw new ApiError("BAD_REQUEST", { message: `Role with id ${data.role} not found` });

    const [user] = await tx
      .insert(users)
      .values({
        name: data.name,
        email: data.email.toLowerCase(),
        phone: transformPhoneNumber(data.phone),
        username: data.username,
        roleId: data.role,
      })
      .returning();

    await tx.insert(credentials).values({
      userId: user.id,
      passwordHash: await bcryptHash(data.password),
    });

    const createdUser = await tx.query.users.findFirst({
      where: eq(users.id, user.id),
      with: {
        role: {
          with: {
            rolePermissions: {
              with: { permission: true },
            },
          },
        },
      },
      columns: {
        id: true,
        name: true,
        email: true,
        phone: true,
        username: true,
        status: true,
        createdAt: true,
      },
    });

    if (!createdUser) throw new ApiError("INTERNAL_SERVER_ERROR", { message: "Failed to retrieve the created user." });

    return {
      ...createdUser,
      role: createdUser.role
        ? {
            id: createdUser.role.id,
            name: createdUser.role.name,
          }
        : null,
      permissions: createdUser.role?.rolePermissions.map((rp) => rp.permission.code) || [],
    };
  });
}

export async function updateUser(id: string, data: UpdateUserParams): Promise<UserType | null> {
  return await db.transaction(async (tx) => {
    const existingUser = await tx.$count(users, and(eq(users.id, id), isNull(users.deletedAt)));

    if (existingUser === 0) {
      throw new ApiError("NOT_FOUND", { message: `User with id ${id} not found` });
    }

    await tx.update(users).set(data).where(eq(users.id, id));

    const updatedUser = await tx.query.users.findFirst({
      where: eq(users.id, id),
      with: {
        role: {
          with: {
            rolePermissions: {
              with: { permission: true },
            },
          },
        },
      },
      columns: {
        id: true,
        name: true,
        email: true,
        phone: true,
        username: true,
        status: true,
        createdAt: true,
      },
    });

    if (!updatedUser) throw new ApiError("INTERNAL_SERVER_ERROR", { message: "Failed to retrieve the updated user." });

    return {
      ...updatedUser,
      role: updatedUser.role
        ? {
            id: updatedUser.role.id,
            name: updatedUser.role.name,
          }
        : null,
      permissions: updatedUser.role?.rolePermissions.map((rp) => rp.permission.code) || [],
    };
  });
}

export async function updateUserPassword(id: string, newPassword: string): Promise<void> {
  const existingUser = await db.$count(users, and(eq(users.id, id), isNull(users.deletedAt)));

  if (existingUser === 0) {
    throw new ApiError("NOT_FOUND", { message: `User with id ${id} not found` });
  }

  const passwordHash = await bcryptHash(newPassword);

  await db.update(credentials).set({ passwordHash }).where(eq(credentials.userId, id));
}

export async function deleteUser(id: string): Promise<void> {
  const existingUser = await db.$count(users, and(eq(users.id, id), isNull(users.deletedAt)));

  if (existingUser === 0) {
    throw new ApiError("NOT_FOUND", { message: `User with id ${id} not found` });
  }

  await db.update(users).set({ deletedAt: new Date(), status: "DELETED" }).where(eq(users.id, id));
}
