import { Hono } from "hono";
import { get } from "../controller/export.controller";

const app = new Hono();

app.get("/", get);

export default app;
