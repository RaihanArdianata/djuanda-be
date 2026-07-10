import { metricsHandler, metricsMiddleware } from "@repo/shared";
import { Hono } from "hono";
import { compression } from "./middleware/compression";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/logger";
import { notFound } from "./middleware/not-found";
import { rateLimit } from "./middleware/rate-limit";
import { requestId } from "./middleware/request-id";
import { security } from "./middleware/security";
import { requestTimeout } from "./middleware/timeout";
import routes from "./routes";

// Urutan: RequestID -> Logger -> Security -> CORS -> Compression -> Timeout -> Rate Limit -> (JWT per-route) -> Proxy
const app = new Hono()
  .use(requestId)
  .use(requestLogger)
  .use(security)
  .use(corsMiddleware)
  .use(compression)
  .use(requestTimeout)
  .use(metricsMiddleware)
  .get("/metrics", metricsHandler)
  .use(rateLimit)
  .route("/", routes)
  .notFound(notFound)
  .onError(errorHandler);

export { app };
export type AppType = typeof app;
