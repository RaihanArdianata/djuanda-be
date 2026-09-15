import { Hono } from "hono";

import docs from "@/docs/route";
import aftn from "@/modules/aftn/route/aftn.route";
import ashtam from "@/modules/ashtam/route/ashtam.route";
import notam from "@/modules/notam/route/notam.route";
import notamQuery from "@/modules/notam/route/notam-query.route";
import health from "./health";

const app = new Hono()
  .route("/advisory/notam", notam)
  .route("/advisory/ashtam", ashtam)
  .route("/advisory/aftn", aftn)
  .route("/advisory/health", health)
  .route("/v1/notams", notamQuery)
  .route("/", docs);

export default app;
