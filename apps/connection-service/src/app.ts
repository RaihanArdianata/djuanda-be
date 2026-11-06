import { corsOriginFromEnv, createCorsMiddleware } from "@repo/shared/cors";
import { errorHandler } from "@repo/shared/error-handler";
import { metricsHandler, metricsMiddleware } from "@repo/shared/metrics";
import { Hono } from "hono";
import { logger } from "hono/logger";
import routes from "./routes";

// Unlike the other services, this one is reached directly from browsers
// (AeroSwarm's dashboard does client-side federation — it connects here for
// this airport's replay/history without going through the gateway), so CORS
// is handled here rather than at the gateway. Same env as every other service:
// CORS_ORIGIN (the old AEROSWARM_CORS_ORIGINS is still read when it is empty).
// An origin that is not listed gets no Access-Control-Allow-Origin at all.
const corsMiddleware = createCorsMiddleware({
  origin: corsOriginFromEnv(process.env),
  allowHeaders: [
    "Content-Type",
    "Authorization",
    "X-Aero-Ingest-Secret",
    // @aeroswarm/client sends it to ask for the standard response envelope.
    "X-Aero-Envelope",
  ],
  allowMethods: ["GET", "POST", "OPTIONS"],
});

const app = new Hono()
  .use(logger())
  .use(corsMiddleware)
  .use(metricsMiddleware)
  .get("/metrics", metricsHandler)
  .route("/", routes)
  .onError(errorHandler);

export { app };
export type AppType = typeof app;
