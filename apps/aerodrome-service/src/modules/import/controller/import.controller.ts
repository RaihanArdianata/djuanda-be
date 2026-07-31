import { catchAsync, success } from "@repo/shared";
import {
  addPreviewFeature,
  cancelImport,
  commitImport,
  createImportSession,
  deletePreviewFeature,
  getImportPreview,
  updatePreviewFeature,
} from "../service/import.service";
import type {
  AddPreviewFeatureInput,
  ImportSessionInput,
  UpdatePreviewFeatureInput,
} from "../validator/import.validator";

export const postImport = catchAsync(async (c) => {
  const parsedData = (await c.get("parsedData")) as ImportSessionInput;
  const { id: userId } = c.get("jwtPayload") as { id: string };

  const { file, mode } = parsedData;

  const geojson = await file.json();
  const session = await createImportSession(file.name, geojson, mode, userId);

  return success(c, session, {
    code: 201,
    message: "Import session created successfully",
  });
});

export const getImport = catchAsync(async (c) => {
  const { importId } = c.req.param();
  const session = await getImportPreview(importId);

  return success(c, session, {
    message: "Import session retrieved successfully",
  });
});

export const updatePreview = catchAsync(async (c) => {
  const { importId, featureId } = c.req.param();
  const parsedBody = (await c.get("parsedBody")) as UpdatePreviewFeatureInput;
  const updatedFeature = await updatePreviewFeature(
    importId,
    featureId,
    parsedBody,
  );

  return success(c, updatedFeature, {
    message: "Preview feature updated successfully",
  });
});

export const deletePreview = catchAsync(async (c) => {
  const { importId, featureId } = c.req.param();
  await deletePreviewFeature(importId, featureId);

  return success(c, null, {
    message: "Preview feature deleted successfully",
  });
});

export const addPreview = catchAsync(async (c) => {
  const { importId } = c.req.param();
  const parsedBody = (await c.get("parsedBody")) as AddPreviewFeatureInput;
  const newFeature = await addPreviewFeature(importId, parsedBody);

  return success(c, newFeature, {
    code: 201,
    message: "Preview feature added successfully",
  });
});

export const commit = catchAsync(async (c) => {
  const { importId } = c.req.param();
  const { id: userId } = c.get("jwtPayload") as { id: string };
  const session = await commitImport(importId, userId);

  return success(c, session, {
    message: "Import session committed successfully",
  });
});

export const cancel = catchAsync(async (c) => {
  const { importId } = c.req.param();
  const session = await cancelImport(importId);
  return success(c, session, {
    message: "Import session canceled successfully",
  });
});
