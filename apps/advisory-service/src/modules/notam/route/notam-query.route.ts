import { Hono } from "hono";
import { list } from "../controller/notam-query.controller";

const app = new Hono().get("/", list);

export default app;
