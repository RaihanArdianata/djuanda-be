import { Hono } from "hono";
import { authentication, rbacMiddleware } from "@/middleware/auth.middleware";
import {
  getPermissions,
  getRolePermissionsHandler,
  getRoles,
  patchRole,
  patchUserRole,
  postAttachPermission,
  postPermission,
  postRole,
  removeAttachedPermission,
  removePermission,
  removeRole,
} from "../controller/access.controller";

// Dua router terpisah, masing-masing di-mount di prefix aslinya sendiri (/roles, /permissions)
export const rolesRoute = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/", getRoles)
  .post("/", postRole)
  .patch("/:id", patchRole)
  .delete("/:id", removeRole)
  .get("/:roleId/permissions", getRolePermissionsHandler)
  .post("/:roleId/permissions", postAttachPermission)
  .delete("/:roleId/permissions/:permissionId", removeAttachedPermission)
  .patch("/:roleId/users/:userId", patchUserRole);

export const permissionsRoute = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/", getPermissions)
  .post("/", postPermission)
  .delete("/:id", removePermission);
