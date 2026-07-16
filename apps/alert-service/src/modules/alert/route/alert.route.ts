import { Hono } from "hono";
import { getAlerts } from "../controller/alert.controller";
import { authentication, rbacMiddleware } from "@repo/auth-service/src/middleware/auth.middleware";

const app = new Hono().use("/*", authentication).use("/*", rbacMiddleware).get("/", getAlerts);

export default app;
