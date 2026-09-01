import { Hono } from "hono";
import { ingest } from "../controller/ingest.controller";
import { getIngestLog } from "../service/ingest.service";

const app = new Hono()
  .options("/log", (c) =>
    c.body(null, 204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }),
  )
  .get("/log", (c) => {
    const data = getIngestLog();
    return c.json({ ok: true, data }, 200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
  })
  .post("/", ingest);

export default app;
