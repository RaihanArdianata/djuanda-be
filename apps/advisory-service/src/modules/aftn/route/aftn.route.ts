import { validate } from "@repo/validation";
import { Hono } from "hono";
import { detail, list, sync } from "../controller/aftn.controller";
import {
  listAftnQuerySchema,
  syncAftnSchema,
} from "../validator/aftn.validator";

const app = new Hono()
  .get("/", validate(listAftnQuerySchema), list)
  .post("/sync", validate(syncAftnSchema), sync)
  .get("/:id", detail);

export default app;
