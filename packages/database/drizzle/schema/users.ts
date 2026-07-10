<<<<<<< HEAD
import type { InferInsertModel } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { userRoles } from "./rbac";

// Domain user-service: profil user (tanpa credential/password)
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  firstName: varchar("first_name", { length: 255 }).notNull(),
  lastName: varchar("last_name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  roleId: integer("role_id").references(() => userRoles.id),
  isPlatformOwner: boolean("is_platform_owner").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
=======
import { InferInsertModel } from 'drizzle-orm';
import { pgTable, uuid, varchar, boolean, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { userRoles } from './rbac';

export const userStatusEnum = pgEnum('users_status_enum', ['ACTIVE', 'INACTIVE', 'DELETED']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 255 }).notNull().unique(),
  roleId: integer('role_id').references(() => userRoles.id),
  status: userStatusEnum('status').default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
});

export type CreateUserProfileInput = InferInsertModel<typeof users>;
export type UserStatus = (typeof userStatusEnum)['enumValues'][number];
