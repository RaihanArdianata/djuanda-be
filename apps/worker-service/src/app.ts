import { corsMiddleware } from "@repo/gateway/src/middleware/cors";
import { playbackWsHandlers } from "@repo/playback-service";
import { metricsHandler, metricsMiddleware } from "@repo/shared";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { logger } from "hono/logger";
import health from "./routes/health";
import { sseHandler } from "./sse";
import { wsHandler } from "./websocket";

const app = new Hono()
  .use(logger())
  .use(metricsMiddleware)
  .use(corsMiddleware)
  .get("/metrics", metricsHandler)
  .route("/health", health)
  .get("/ws/playback/:sessionId", playbackWsHandlers)
  .get("/ws/:topic", wsHandler)
  .get("/events/:topic", sseHandler);

export { app, websocket };
export default app;
