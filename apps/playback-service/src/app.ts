import { errorHandler } from "@repo/shared/error-handler";
import { metricsHandler, metricsMiddleware } from "@repo/shared/metrics";
import { Hono } from "hono";
import { logger } from "hono/logger";
import routes from "./routes";

const app = new Hono()
  .use(logger())
  .use(metricsMiddleware)
  .get("/metrics", metricsHandler)
  .route("/", routes)
  .onError(errorHandler);

export { app };
export default app;
export type AppType = typeof app;
