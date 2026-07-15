import { Hono } from "hono";
import health from "./health";
import route from "@/modules/alert/route/alert.route";

const app = new Hono().route("/health", health).route("/alert", route);

export default app;
