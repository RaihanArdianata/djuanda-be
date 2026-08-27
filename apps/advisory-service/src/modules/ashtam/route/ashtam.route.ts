import { Hono } from "hono";
import {
  active,
  detail,
  list,
  query,
  sync,
} from "../controller/ashtam.controller";

const app = new Hono()
  .get("/", list)
  .get("/active", active)
  .get("/query", query)
  .post("/sync", sync)
  .get("/:id", detail);

export default app;
