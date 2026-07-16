import {
  authentication,
  rbacMiddleware,
} from "@repo/auth-service/src/middleware/auth.middleware";
import { validate } from "@repo/validation";
import { Hono } from "hono";
import {
  create,
  getAll,
  remove,
  update,
  updatePassword,
} from "../controller/user.controller";
import {
  createUserSchema,
  getAllUsersSchema,
  updateUserPasswordSchema,
  updateUserSchema,
} from "../validator/user.validator";

const app = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/", validate(getAllUsersSchema), getAll)
  .post("/", validate(createUserSchema), create)
  .patch("/:id", validate(updateUserSchema), update)
  .put(
    "/:id/update-password",
    validate(updateUserPasswordSchema),
    updatePassword,
  )
  .delete("/:id", remove);

export default app;
