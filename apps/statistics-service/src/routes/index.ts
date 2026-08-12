
import { Hono } from "hono";
import route from "@/modules/statistics/route/statistics.route";
import health from "./health";
import docs from"@/docs/route"

const app = new Hono()
  .route("/health", health)
  .route("/", docs)
  .route("/statistics", route);

export default app;
