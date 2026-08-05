import { validate } from "@repo/validation";
import { Hono } from "hono";
import { get } from "../controller/layer.controller";
import { layerFilterSchema } from "../validator/layer.validator";

const app = new Hono();

app.get("/", validate(layerFilterSchema), get);

export default app;
