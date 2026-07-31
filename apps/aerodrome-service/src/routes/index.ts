import {
  authentication,
  rbacMiddleware,
} from "@repo/auth-service/src/middleware/auth.middleware";
import { Hono } from "hono";
import docs from "@/docs/route";
import exportRoute from "@/modules/export/route/export.route";
import featureRoute from "@/modules/feature/route/feature.route";
import importRoute from "@/modules/import/route/import.route";
import layerRoute from "@/modules/layer/route/layer.route";
import health from "./health";

const app = new Hono()
  .route("/health", health)
  .route("/", docs)
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .route("/aerodrome/export", exportRoute)
  .route("/aerodrome/layers", layerRoute)
  .route("/aerodrome/features", featureRoute)
  .route("/aerodrome/import", importRoute);

export default app;
