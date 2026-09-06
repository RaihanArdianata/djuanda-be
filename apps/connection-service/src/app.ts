import { errorHandler, metricsHandler, metricsMiddleware } from "@repo/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import routes from "./routes";

// Unlike the other services, this one is reached directly from browsers
// (AeroSwarm's dashboard does client-side federation — it connects here for
// this airport's replay/history without going through the gateway), so CORS
// is handled here rather than at the gateway.
const allowedOrigins = (process.env.AEROSWARM_CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin: string): boolean =>
  allowedOrigins.length === 0 ||
  allowedOrigins.includes("*") ||
  allowedOrigins.includes(origin);

const corsMiddleware = cors({
  origin: (origin: string) => (isAllowedOrigin(origin) ? origin : "*"),
  allowHeaders: ["Content-Type", "Authorization", "X-Aero-Ingest-Secret"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  maxAge: 600,
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
