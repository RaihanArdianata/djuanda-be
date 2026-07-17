import { metricsHandler, metricsMiddleware } from "@repo/shared";
import { Hono } from "hono";
import { logger } from "hono/logger";
import routes from "./routes";

const app = new Hono()
  .use(logger())
  .use(metricsMiddleware)
  .get("/metrics", metricsHandler)
  .route("/", routes);

export { app };
export type AppType = typeof app;
