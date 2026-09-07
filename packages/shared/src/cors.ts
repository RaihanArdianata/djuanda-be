import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

export const createCorsMiddleware = (options: {
  origin: string;
}): MiddlewareHandler =>
  cors({
    origin: options.origin,
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Request-Id"],
    maxAge: 600,
  });
