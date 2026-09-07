import { authentication, rbacMiddleware } from "@repo/auth";
import { validate } from "@repo/validation";
import { Hono } from "hono";
import { getMovementsController } from "../controller/movement.controller";
import { getMovementsSchema } from "../validator/movement.validator";

const app = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/", validate(getMovementsSchema), getMovementsController);

export default app;
