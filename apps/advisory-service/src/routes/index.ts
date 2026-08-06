import { Hono } from "hono";

import docs from "@/docs/route";
import ashtam from "@/modules/ashtam/route/ashtam.route";
import notam from "@/modules/notam/route/notam.route";
import health from "./health";

const app = new Hono()
  .route("/advisory/notam", notam)
  .route("/advisory/ashtam", ashtam)
  .route("/advisory/health", health)
  .route("/", docs);

export default app;
