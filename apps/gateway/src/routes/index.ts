import { Hono } from "hono";
import auth from "./auth";
import health from "./health";
import notifications from "./notifications";
import rbac from "./rbac";

const app = new Hono()
  .route("/auth", auth)
  .route("/notifications", notifications)
  .route("/roles", rbac)
  .route("/permissions", rbac)
  .route("/health", health);

export default app;
