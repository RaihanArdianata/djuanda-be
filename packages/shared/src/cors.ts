import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

/**
 * `CORS_ORIGIN` as Hono wants it: "*" for any origin, one origin as a string, several as a list.
 * Several are written comma-separated ("https://app.example,http://localhost:5173"). Hono sends
 * no Access-Control-Allow-Origin at all for an origin that is not in the list, so a browser from
 * any other origin is refused.
 */
export function parseCorsOrigin(raw: string): string | string[] {
  const origins = raw
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => o.length > 0);
  if (origins.length === 0 || origins.includes("*")) return "*";
  return origins.length === 1 ? (origins[0] as string) : origins;
}

export const createCorsMiddleware = (options: {
  origin: string;
}): MiddlewareHandler =>
  cors({
    origin: parseCorsOrigin(options.origin),
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Request-Id"],
    maxAge: 600,
  });
