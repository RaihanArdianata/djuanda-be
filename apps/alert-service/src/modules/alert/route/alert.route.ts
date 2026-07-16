import { Hono } from "hono";
import { getAlerts } from "../controller/alert.controller";

const app = new Hono().get("/", getAlerts);

export default app;
