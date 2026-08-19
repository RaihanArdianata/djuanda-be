import {
  authentication,
  rbacMiddleware,
} from "@repo/auth-service/src/middleware/auth.middleware";
import { Hono } from "hono";
import {
  acknowledgeAlertController,
  clearAlertController,
  detectAlertController,
  getAlertByIdController,
  listActiveAlertsController,
  listAlertsController,
} from "../controller/alert.controller";

const app = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/", listAlertsController)
  .get("/active", listActiveAlertsController)
  .post("/detect", detectAlertController)
  .get("/:id", getAlertByIdController)
  .post("/:id/acknowledge", acknowledgeAlertController)
  .post("/:id/clear", clearAlertController);

export default app;
