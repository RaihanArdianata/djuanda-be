import { playbackWsHandlers } from "@repo/playback-service/ws-handler";
import { createCorsMiddleware } from "@repo/shared/cors";
import { metricsHandler, metricsMiddleware } from "@repo/shared/metrics";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { logger } from "hono/logger";
import health from "./routes/health";
import { sseHandler } from "./sse";
import { wsHandler } from "./websocket";

const app = new Hono()
  .use(logger())
  .use(metricsMiddleware)
  .use(createCorsMiddleware({ origin: process.env.CORS_ORIGIN ?? "*" }))
  .get("/metrics", metricsHandler)
  .route("/health", health)
  .get("/ws/playback/:sessionId", playbackWsHandlers)
  .get("/ws/:topic", wsHandler)
  .get("/events/:topic", sseHandler);

export { app, websocket };
export default app;
