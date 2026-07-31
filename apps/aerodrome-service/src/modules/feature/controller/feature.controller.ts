import { catchAsync, success } from "@repo/shared";
import type {
  CreateFeatureInput,
  ListFeatureQueryInput,
  UpdateFeatureInput,
} from "../validator/feature.validator";
import {
  listFeatures,
  getFeatureById,
  createFeature,
  updateFeature,
  deleteFeature,
} from "../service/feature.service";

export const getFeatures = catchAsync(async (c) => {
  const parsedData = (await c.get("parsedData")) as ListFeatureQueryInput;

  const result = await listFeatures(parsedData);

  return success(c, result, {
    message: "Features retrieved successfully",
  });
});

export const getById = catchAsync(async (c) => {
  const id = c.req.param("id");
  const feature = await getFeatureById(id as string);

  return success(c, feature, {
    message: "Feature retrieved successfully",
  });
});

export const create = catchAsync(async (c) => {
  const parsedData = (await c.get("parsedData")) as CreateFeatureInput;
  const { id: userId } = c.get("jwtPayload") as { id: string };

  const feature = await createFeature({ ...parsedData, userId });

  return success(c, feature, {
    message: "Feature created successfully",
  });
});

export const edit = catchAsync(async (c) => {
  const id = c.req.param("id");
  const parsedData = (await c.get("parsedData")) as UpdateFeatureInput;
  const { id: userId } = c.get("jwtPayload") as { id: string };

  const feature = await updateFeature(id as string, parsedData, userId);

  return success(c, feature, {
    message: "Feature updated successfully",
  });
});

export const deleteById = catchAsync(async (c) => {
  const id = c.req.param("id");
  await deleteFeature(id as string);

  return success(c, null, {
    message: "Feature deleted successfully",
  });
});
