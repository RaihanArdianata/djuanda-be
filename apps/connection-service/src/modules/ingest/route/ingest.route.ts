import { Hono } from "hono";
import { ingest } from "../controller/ingest.controller";
import { getIngestLog } from "../service/ingest.service";

const app = new Hono()
  .get("/log", (c) => {
    const data = getIngestLog();
    return c.json({ ok: true, data });
  })
  .post("/", ingest);

export default app;
