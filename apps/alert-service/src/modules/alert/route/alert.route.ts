import { authentication, rbacMiddleware } from "@repo/auth";
import { Hono } from "hono";
import {
  acknowledgeAlertController,
  bulkClearAlertController,
  clearAlertController,
  deleteAlertController,
  detectAlertController,
  exportAlertsController,
  getAlertActionsController,
  getAlertByIdController,
  getAlertTrackHistoryController,
  listActiveAlertsController,
  listAlertsController,
  verifyAlertController,
} from "../controller/alert.controller";

const app = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/", listAlertsController)
  .get("/active", listActiveAlertsController)
  .get("/export", exportAlertsController)
  .post("/detect", detectAlertController)
  .post("/clear-bulk", bulkClearAlertController)
  .get("/:id", getAlertByIdController)
  .get("/:id/history", getAlertTrackHistoryController)
  .get("/:id/actions", getAlertActionsController)
  .post("/:id/acknowledge", acknowledgeAlertController)
  .post("/:id/clear", clearAlertController)
  .post("/:id/verify", verifyAlertController)
  .delete("/:id", deleteAlertController);

export default app;
