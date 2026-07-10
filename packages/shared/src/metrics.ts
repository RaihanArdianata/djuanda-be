import type { Context, Next } from "hono";
import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Durasi request HTTP dalam detik",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total request HTTP yang diproses",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
});

export const metricsMiddleware = async (
  c: Context,
  next: Next,
): Promise<void> => {
  const start = process.hrtime.bigint();
  await next();
  const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;

  const route = c.req.routePath ?? c.req.path;
  const labels = {
    method: c.req.method,
    route,
    status_code: String(c.res.status),
  };

  httpRequestDuration.observe(labels, durationSeconds);
  httpRequestsTotal.inc(labels);
};

export const metricsHandler = async (c: Context): Promise<Response> => {
  c.header("Content-Type", registry.contentType);
  return c.body(await registry.metrics());
};
