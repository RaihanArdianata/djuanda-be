import { Hono } from "hono";
import advisory from "./advisory";
import aerodrome from "./aerodrome";
import alert from "./alert";
import alertRules from "./alert-rules";
import auth from "./auth";
import connection from "./connection";
import health from "./health";
import notams from "./notams";
import notifications from "./notifications";
import playback from "./playback";
import rbac from "./rbac";
import sse from "./sse";
import statistics from "./statistics";
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
  .route("/alert-rules", alertRules)
  .route("/users", users)
  .route("/advisory", advisory)
  .route("/aero/tracks", connection)
  .route("/weather", weather)
  .route("/aerodrome", aerodrome)
  .route("/statistics", statistics)
  .route("/playback", playback)
  .route("/v1/notams", notams);

export default app;
