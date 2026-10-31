import { Hono } from "hono";

const app = new Hono().get("/", (c) =>
  c.json({
    status: "ok",
    process: { status: "healthy" },
    source: { configured: Boolean(process.env.SOURCE_PORT) },
    decoder: { status: "ready" },
    database: { configured: Boolean(process.env.DATABASE_URL) },
    connector: { status: "configured" },
  }),
);

export default app;
