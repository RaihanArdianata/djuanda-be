import { validate } from "@repo/validation";
import { Hono } from "hono";
import { detail, list } from "../controller/aftn.controller";
import { listAftnQuerySchema } from "../validator/aftn.validator";

const app = new Hono()
  .get("/", validate(listAftnQuerySchema), list)
  .get("/:id", detail);

export default app;
