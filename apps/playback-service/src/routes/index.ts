import { authentication, rbacMiddleware } from "@repo/auth";
import { Hono } from "hono";
import docs from "../docs/route";
import playbackRoute from "../modules/routes/playback.route";
import health from "./health";

const app = new Hono()
  .route("/", docs)
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .route("/health", health)
  .route("/playback", playbackRoute);

export default app;
