import type { InferInsertModel } from "drizzle-orm";
import {
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { userRoles } from "./rbac";

export const userStatusEnum = pgEnum("users_status_enum", [
  "ACTIVE",
  "INACTIVE",
  "DELETED",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  roleId: integer("role_id").references(() => userRoles.id),
  status: userStatusEnum("status").default("ACTIVE"),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type CreateUserProfileInput = InferInsertModel<typeof users>;
export type UserStatus = (typeof userStatusEnum)["enumValues"][number];
