import { validate } from "@repo/validation";
import { Hono } from "hono";
import {
  addPreview,
  cancel,
  commit,
  deletePreview,
  getImport,
  postImport,
  updatePreview,
} from "../controller/import.controller";
import {
  addPreviewFeatureSchema,
  importSessionSchema,
  updatePreviewFeatureSchema,
} from "../validator/import.validator";

const app = new Hono();

app
  .post("/", validate(importSessionSchema), postImport)
  .get("/:importId", getImport)
  .patch(
    "/:importId/features/:featureId",
    validate(updatePreviewFeatureSchema),
    updatePreview,
  )
  .delete("/:importId/features/:featureId", deletePreview)
  .post("/:importId/features", validate(addPreviewFeatureSchema), addPreview)
  .post("/:importId/commit", commit)
  .delete("/:importId", cancel);

export default app;
