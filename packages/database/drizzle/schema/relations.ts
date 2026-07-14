import { type BuildQueryResult, type ExtractTablesWithRelations, relations } from 'drizzle-orm';
import type * as schema from '../schema';
import { credentials } from './auth';
import { permissions, rolePermissions, userRoles } from './rbac';
import { users } from './users';

export const userRolesRelations = relations(userRoles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(userRoles, {
    fields: [rolePermissions.roleId],
    references: [userRoles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(userRoles, {
    fields: [users.roleId],
    references: [userRoles.id],
  }),
  credentials: one(credentials, {
    fields: [users.id],
    references: [credentials.userId],
  }),
}));

export const userPermissionsQueryConfig = {
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
} as const;

type SchemaType = typeof schema;

type TablesWithRelations = ExtractTablesWithRelations<SchemaType>;

export type UserWithPermissionsType = BuildQueryResult<TablesWithRelations, TablesWithRelations['users'], typeof userPermissionsQueryConfig>;
