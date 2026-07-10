<<<<<<< HEAD
import { join } from "node:path";
import { errorHandler, metricsHandler, metricsMiddleware } from "@repo/shared";
import { Hono } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import routes from "./routes";
import { wsHandler } from "./websocket";

const { websocket } = createBunWebSocket();
=======
import { Hono } from 'hono';
import { websocket, serveStatic } from 'hono/bun';
import { logger } from 'hono/logger';
import { errorHandler, metricsMiddleware, metricsHandler } from '@repo/shared';
import { join } from 'path';
import routes from './routes';
import { wsHandler } from './websocket';
import { sseHandler } from './sse';
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0

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
<<<<<<< HEAD
    "/file-data/*",
    serveStatic({
      root: "./public",
      rewriteRequestPath: (path: string) => path.replace("/file-data/", ""),
    }),
  )
  .get("/ws/:topic", wsHandler)
  .route("/", routes)
=======
    '/file-data/*',
    serveStatic({
      root: './public',
      rewriteRequestPath: (path) => path.replace('/file-data/', ''),
    })
  )
  .get('/ws/:topic', wsHandler)
  .get('/sse/:topic', sseHandler)
  .route('/', routes)
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
  .onError(errorHandler);

export { app, websocket };
export type AppType = typeof app;
