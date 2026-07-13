import { join } from "node:path";
import { errorHandler, metricsHandler, metricsMiddleware } from "@repo/shared";
import { Hono } from "hono";
import { serveStatic, websocket } from "hono/bun";
import { logger } from "hono/logger";
import routes from "./routes";
import { sseHandler } from "./sse";
import { wsHandler } from "./websocket";

const app = new Hono()
  .use(logger())
  .use(metricsMiddleware)
  .get("/metrics", metricsHandler)
  .use("/public/*", async (c) => {
    const publicPath = join(process.cwd(), "public");
    const filePath = join(publicPath, c.req.path.replace("/public/", ""));
    return new Response(Bun.file(filePath));
  })
  .use(
    "/file-data/*",
    serveStatic({
      root: "./public",
      rewriteRequestPath: (path: string) => path.replace("/file-data/", ""),
    }),
  )
  .get("/ws/:topic", wsHandler)
  .get("/sse/:topic", sseHandler)
  .route("/", routes)
  .onError(errorHandler);

export { app, websocket };
export type AppType = typeof app;
