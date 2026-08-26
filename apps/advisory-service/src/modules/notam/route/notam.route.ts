import { Hono } from "hono";
import { list } from "../controller/notam.controller";

const app = new Hono().get("/", list);

export default app;
