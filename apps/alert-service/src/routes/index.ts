import { Hono } from "hono";
import route from "@/modules/alert/route/alert.route";
import health from "./health";

const app = new Hono().route("/health", health).route("/alert", route);

export default app;
