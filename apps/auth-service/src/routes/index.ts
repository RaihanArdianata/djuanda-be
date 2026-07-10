import { Hono } from "hono";
import docs from "@/docs/route";
import {
  permissionsRoute,
  rolesRoute,
} from "@/modules/access/route/access.route";
import auth from "@/modules/auth/route/auth.route";
import storage from "@/modules/storage/route/storage.route";
import health from "./health";

const app = new Hono()
  .route("/auth", auth)
  .route("/storage", storage)
  .route("/roles", rolesRoute)
  .route("/permissions", permissionsRoute)
  .route("/health", health)
  .route("/", docs);

export default app;
