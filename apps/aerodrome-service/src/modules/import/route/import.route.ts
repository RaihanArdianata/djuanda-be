import { validate } from "@repo/validation";
import { Hono } from "hono";
import {
  addPreview,
  deletePreview,
  getImport,
  postImport,
  updatePreview,
  commit,
  cancel,
} from "../controller/import.controller";
import {
  importSessionSchema,
  updatePreviewFeatureSchema,
  addPreviewFeatureSchema,
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
