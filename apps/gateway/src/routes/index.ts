import { Hono } from "hono";
import aerodrome from "./aerodrome";
import alert from "./alert";
import auth from "./auth";
import health from "./health";
import notam from "./notam";
import notifications from "./notifications";
import rbac from "./rbac";
import sse from "./sse";
import users from "./users";
import weather from "./weather";
import ws from "./ws";

const app = new Hono()
  .route("/auth", auth)
  .route("/notifications", notifications)
  .route("/roles", rbac)
  .route("/permissions", rbac)
  .route("/health", health)
  .route("/ws", ws)
  .route("/events", sse)
  .route("/alert", alert)
  .route("/users", users)
  .route("/notam", notam)
  .route("/weather", weather)
  .route("/aerodrome", aerodrome);

export default app;
