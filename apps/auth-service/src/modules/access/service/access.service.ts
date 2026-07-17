import {
  auditRoleChanges,
  db,
  permissions,
  rolePermissions,
  userRoles,
  users,
} from "@repo/database";
import { and, count, eq } from "drizzle-orm";

type UserRolesType = typeof userRoles.$inferSelect;
type PermissionType = typeof permissions.$inferSelect;
type RolePermissionType = typeof rolePermissions.$inferSelect;
type UserType = typeof users.$inferSelect;

type ListRolesWithUserCountType = UserRolesType & { userCount: number };

export async function listRoles(): Promise<ListRolesWithUserCountType[]> {
  const results = await db
    .select({
      id: userRoles.id,
      name: userRoles.name,
      description: userRoles.description,
      userCount: count(users.id),
    })
    .from(userRoles)
    .leftJoin(users, eq(userRoles.id, users.roleId))
    .groupBy(userRoles.id, userRoles.name, userRoles.description);

  return results;
}

export async function createRole(data: {
  name: string;
  description?: string;
}): Promise<UserRolesType> {
  const [role] = await db.insert(userRoles).values(data).returning();
  return role;
}

export async function updateRole(
  id: number,
  data: { name?: string; description?: string },
): Promise<UserRolesType> {
  const [role] = await db
    .update(userRoles)
    .set(data)
    .where(eq(userRoles.id, id))
    .returning();
  return role ?? null;
}

export async function deleteRole(id: number): Promise<UserRolesType> {
  const [role] = await db
    .delete(userRoles)
    .where(eq(userRoles.id, id))
    .returning();
  return role ?? null;
}

export async function listPermissions(): Promise<PermissionType[]> {
  return await db.select().from(permissions);
}

export async function createPermission(data: {
  name: string;
  code: string;
  description?: string;
}): Promise<PermissionType> {
  const [permission] = await db.insert(permissions).values(data).returning();
  return permission;
}

export async function deletePermission(id: string): Promise<PermissionType> {
  const [permission] = await db
    .delete(permissions)
    .where(eq(permissions.id, id))
    .returning();
  return permission ?? null;
}

type RenamedPermission = Omit<PermissionType, "id"> & {
  permissionId: string;
};

export async function getRolePermissions(
  roleId: number,
): Promise<RenamedPermission[]> {
  return await db
    .select({
      permissionId: permissions.id,
      name: permissions.name,
      code: permissions.code,
      description: permissions.description,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId));
}

export async function attachPermissionToRole(
  roleId: number,
  permissionId: string,
): Promise<RolePermissionType> {
  const [attached] = await db
    .insert(rolePermissions)
    .values({ roleId, permissionId })
    .returning();
  return attached;
}

export async function detachPermissionFromRole(
  roleId: number,
  permissionId: string,
): Promise<RolePermissionType> {
  const [detached] = await db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, roleId),
        eq(rolePermissions.permissionId, permissionId),
      ),
    )
    .returning();

  return detached ?? null;
}

export async function changeUserRole({
  changedByUserId,
  targetUserId,
  newRoleId,
  reason,
}: {
  changedByUserId: string;
  targetUserId: string;
  newRoleId: number;
  reason?: string;
}): Promise<UserType | null> {
  return await db.transaction(async (tx) => {
    const [targetUser] = await tx
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!targetUser) return null;

    const oldRoleId = targetUser.roleId;

    const [updatedUser] = await tx
      .update(users)
      .set({ roleId: newRoleId })
      .where(eq(users.id, targetUserId))
      .returning();

    await tx.insert(auditRoleChanges).values({
      changedByUserId,
      targetUserId,
      oldRoleId,
      newRoleId,
      reason,
    });

    return updatedUser;
  });
}
