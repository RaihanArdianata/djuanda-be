import { Hono } from "hono";
import alert from "./alert";
import auth from "./auth";
import health from "./health";
import notifications from "./notifications";
import rbac from "./rbac";
import sse from "./sse";
import ws from "./ws";

const app = new Hono()
  .route("/auth", auth)
  .route("/notifications", notifications)
  .route("/roles", rbac)
  .route("/permissions", rbac)
  .route("/health", health)
  .route("/ws", ws)
  .route("/sse", sse)
  .route("/alert", alert)
  .route("/health", health);

export default app;
