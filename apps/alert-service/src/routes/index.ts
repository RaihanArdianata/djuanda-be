import { Hono } from "hono";
import route from "@/modules/alert/route/alert.route";
import ruleRoute from "@/modules/alert.rule/route/alert.rule.route";
import health from "./health";

const app = new Hono()
  .route("/health", health)
  .route("/alert", route)
  .route("/alert-rules", ruleRoute);

export default app;
