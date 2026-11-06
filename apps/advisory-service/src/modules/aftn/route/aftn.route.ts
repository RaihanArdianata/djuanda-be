import { validate } from "@repo/validation";
import { Hono } from "hono";
import { detail, latest, list } from "../controller/aftn.controller";
import {
  latestAftnQuerySchema,
  listAftnQuerySchema,
} from "../validator/aftn.validator";

const app = new Hono()
  .get("/latest", validate(latestAftnQuerySchema), latest)
  .get("/", validate(listAftnQuerySchema), list)
  .get("/:id", detail);

export default app;
