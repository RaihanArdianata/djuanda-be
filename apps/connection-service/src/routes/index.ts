import { Hono } from "hono";

import history from "@/modules/history/route/history.route";
import ingest from "@/modules/ingest/route/ingest.route";
import health from "./health";

const app = new Hono()
  .route("/aero/ingest", ingest)
  .route("/aero", history)
  .route("/health", health);

export default app;
