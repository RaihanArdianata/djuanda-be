import { validate } from "@repo/validation";
import { Hono } from "hono";
import {
  createFeatureSchema,
  listFeatureQuerySchema,
  updateFeatureSchema,
} from "../validator/feature.validator";
import {
  create,
  deleteById,
  edit,
  getById,
  getFeatures,
} from "../controller/feature.controller";

const app = new Hono();

app
  .get("/", validate(listFeatureQuerySchema), getFeatures)
  .get("/:id", getById)
  .post("/", validate(createFeatureSchema), create)
  .patch("/:id", validate(updateFeatureSchema), edit)
  .delete("/:id", deleteById);

export default app;
