import { Hono } from "hono";
import { list } from "../controller/ashtam.controller";

const app = new Hono().get("/", list);

export default app;
