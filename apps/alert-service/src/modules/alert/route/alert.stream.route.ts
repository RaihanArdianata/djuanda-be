import { Hono } from "hono";
import { alertStreamController } from "../controller/alert-stream.controller";
import { sseAuthentication } from "../middleware/sse-auth.middleware";

const app = new Hono().get("/", sseAuthentication, alertStreamController);

export default app;
