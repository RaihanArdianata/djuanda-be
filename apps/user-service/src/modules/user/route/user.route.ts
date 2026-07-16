import { Hono } from "hono";
import { validate } from "@repo/validation";
import { createUserSchema, getAllUsersSchema, updateUserPasswordSchema, updateUserSchema } from "../validator/user.validator";
import { getAll, create, update, remove, updatePassword } from "../controller/user.controller";
import { authentication, rbacMiddleware } from "@repo/auth-service/src/middleware/auth.middleware";

const app = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/", validate(getAllUsersSchema), getAll)
  .post("/", validate(createUserSchema), create)
  .patch("/:id", validate(updateUserSchema), update)
  .put("/:id/update-password", validate(updateUserPasswordSchema), updatePassword)
  .delete("/:id", remove);

export default app;
