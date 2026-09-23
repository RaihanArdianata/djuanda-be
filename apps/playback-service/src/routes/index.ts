import { authentication, rbacMiddleware } from "@repo/auth";
import { Hono } from "hono";
import docs from "../docs/route";
import playbackRoute from "../modules/routes/playback.route";
import health from "./health";

const app = new Hono()
  .route("/", docs)
  .route("/health", health)
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .route("/playback", playbackRoute);

export default app;
