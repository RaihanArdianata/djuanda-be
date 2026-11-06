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

/**
 * Origin yang diizinkan untuk sebuah service, dari env yang sama di semua service: `CORS_ORIGIN`. Nama lama
 * `AEROSWARM_CORS_ORIGINS` (connection-service) masih dibaca bila `CORS_ORIGIN` kosong, supaya `.env` lama tetap jalan.
 * Tanpa keduanya dipakai `fallback` (bawaan "*": tiap service boleh mengganti bawaannya sendiri).
 */
export function corsOriginFromEnv(
  env: Record<string, string | undefined>,
  fallback = "*",
): string {
  const primary = env.CORS_ORIGIN?.trim();
  if (primary) return primary;
  const legacy = env.AEROSWARM_CORS_ORIGINS?.trim();
  if (legacy) return legacy;
  return fallback;
}

/** Header dan metode yang dibawa permintaan lintas origin; bawaan cukup untuk REST yang lewat gateway. */
const DEFAULT_ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Request-Id",
  // @aeroswarm/client memakainya saat mengambil jejak (/aero/tracks/:id/trail) lewat gateway. Dari origin lain
  // (dev lokal, FE di server berbeda) tanpa ini preflight menolak dan garis jejak tidak muncul.
  "X-Aero-Envelope",
];
const DEFAULT_ALLOW_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

export const createCorsMiddleware = (options: {
  origin: string;
  /** Mengganti daftar header yang diizinkan (service yang dipanggil langsung oleh peramban dengan header khusus). */
  allowHeaders?: string[];
  allowMethods?: string[];
}): MiddlewareHandler =>
  cors({
    origin: parseCorsOrigin(options.origin),
    allowHeaders: options.allowHeaders ?? DEFAULT_ALLOW_HEADERS,
    allowMethods: options.allowMethods ?? DEFAULT_ALLOW_METHODS,
    exposeHeaders: ["X-Request-Id"],
    maxAge: 600,
  });
