import { Hono } from "hono";

import history from "@/modules/history/route/history.route";
import ingest from "@/modules/ingest/route/ingest.route";
import trace from "@/modules/trace/trace.route";
import trail from "@/modules/trail/trail.route";
import health from "./health";

const app = new Hono()
  .route("/aero/ingest", ingest)
  .route("/aero", trail)
  .route("/aero", trace)
  .route("/aero", history)
  .route("/health", health);

export default app;
