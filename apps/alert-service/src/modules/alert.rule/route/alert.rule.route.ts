import {
  authentication,
  rbacMiddleware,
} from "@repo/auth-service/src/middleware/auth.middleware";
import { Hono } from "hono";
import {
  createAlertRuleController,
  getAlertRuleByIdController,
  listAlertRulesController,
  updateAlertRuleController,
} from "../controller/alert.rule.controller";

const app = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/", listAlertRulesController)
  .get("/:id", getAlertRuleByIdController)
  .post("/", createAlertRuleController)
  .put("/:id", updateAlertRuleController);

export default app;
