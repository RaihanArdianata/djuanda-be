import { Hono } from "hono";
import docs from "@/docs/route";
import movementRoute from "@/modules/movement/route/movement.route";
import route from "@/modules/statistics/route/statistics.route";
import health from "./health";

const app = new Hono()
  .route("/health", health)
  .route("/", docs)
  .route("/statistics", route)
  .route("/statistics/movements", movementRoute);

export default app;
