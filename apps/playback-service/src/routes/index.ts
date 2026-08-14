import {
  authentication,
  rbacMiddleware,
} from "@repo/auth-service/src/middleware/auth.middleware";
import playbackRoute from "@/modules/routes/playback.route";
import { Hono } from "hono";
import health from "./health";
import docs from "@/docs/route";

const app = new Hono()
  .route("/", docs)
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .route("/health", health)
  .route("/playback", playbackRoute);

export default app;
