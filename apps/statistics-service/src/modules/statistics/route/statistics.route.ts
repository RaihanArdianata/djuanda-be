import { authentication, rbacMiddleware } from "@repo/auth";
import { validate } from "@repo/validation";
import { Hono } from "hono";
import { getOperational } from "../controller/statistics.controller";
import { getOperationalStatisticsSchema } from "../validator/statistics.validator";

const app = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get(
    "/operational",
    validate(getOperationalStatisticsSchema),
    getOperational,
  );

export default app;
