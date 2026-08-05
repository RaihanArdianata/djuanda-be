import { Hono } from "hono";

import docs from "@/docs/route";
import notam from "@/modules/route/notam.route";
import health from "./health";

const app = new Hono()
  .route("/notam", notam)
  .route("/health", health)
  .route("/", docs);

export default app;
