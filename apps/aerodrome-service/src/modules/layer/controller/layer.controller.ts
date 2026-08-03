import { catchAsync, success } from "@repo/shared";
import { getLayers } from "../service/layer.service";
import type { LayerFilter } from "../validator/layer.validator";

export const get = catchAsync(async (c) => {
  const parsedData = (await c.get("parsedData")) as LayerFilter;

  const layers = await getLayers(parsedData);

  return success(c, layers, {
    message: "Successfully retrieved layers",
  });
});
