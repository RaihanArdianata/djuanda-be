import { authentication, rbacMiddleware } from "@repo/auth";
import { Hono } from "hono";
import {
  acknowledgeAlertController,
  clearAlertController,
  detectAlertController,
  exportAlertsController,
  getAlertByIdController,
  getAlertTrackHistoryController,
  listActiveAlertsController,
  listAlertsController,
} from "../controller/alert.controller";

const app = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/", listAlertsController)
  .get("/active", listActiveAlertsController)
  .get("/export", exportAlertsController)
  .post("/detect", detectAlertController)
  .get("/:id", getAlertByIdController)
  .get("/:id/history", getAlertTrackHistoryController)
  .post("/:id/acknowledge", acknowledgeAlertController)
  .post("/:id/clear", clearAlertController);

export default app;
