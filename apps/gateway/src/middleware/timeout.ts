import { logger } from "@repo/logger";
import type { Context, Next } from "hono";
import { timeout } from "hono/timeout";
import { DEFAULT_TIMEOUT_MS } from "../config/constants";

export const requestTimeout = async (
  c: Context,
  next: Next,
): Promise<undefined | Response> => {
  // if the request is sse or websocket, we don't want to apply the timeout
  if (
    c.req.header("Accept") === "text/event-stream" ||
    c.req.header("Upgrade") === "websocket"
  ) {
    logger.info(
      `Request timeout middleware skipped for ${c.req.method} ${c.req.url} because it's an SSE or WebSocket request`,
    );
    return next() as Promise<undefined | Response>;
  }

  return timeout(DEFAULT_TIMEOUT_MS)(c, next) as Promise<undefined | Response>;
};
