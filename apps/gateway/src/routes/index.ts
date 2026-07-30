import { Hono } from "hono";
import alert from "./alert";
import auth from "./auth";
import health from "./health";
import notam from "./notam";
import notifications from "./notifications";
import rbac from "./rbac";
import sse from "./sse";
import users from "./users";
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
  .route("/users", users)
  .route("/notam", notam);

export default app;
