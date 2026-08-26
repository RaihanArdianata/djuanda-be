import { Hono } from "hono";

import docs from "@/docs/route";
import aftn from "@/modules/aftn/route/aftn.route";
import ashtam from "@/modules/ashtam/route/ashtam.route";
import notam from "@/modules/notam/route/notam.route";
import notamTrigger from "@/modules/notam-trigger/route/notam-trigger.route";
import health from "./health";

const app = new Hono()
  .route("/advisory/notam", notam)
  .route("/advisory/notam", notamTrigger)
  .route("/advisory/ashtam", ashtam)
  .route("/advisory/aftn", aftn)
  .route("/advisory/health", health)
  .route("/", docs);

export default app;
