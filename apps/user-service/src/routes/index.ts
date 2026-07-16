import { Hono } from "hono";
import health from "./health";

const app = new Hono()
  .route("/health", health)
  .route("/", await import("@/modules/docs/route").then((m) => m.default))
  .route("/users", await import("@/modules/user/route/user.route").then((m) => m.default));

export default app;
