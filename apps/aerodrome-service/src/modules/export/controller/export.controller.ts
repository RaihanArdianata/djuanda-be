import { catchAsync, success } from "@repo/shared";
import { getAerodromeExport } from "../service/export.service";

export const get = catchAsync(async (c) => {
  const geojson = await getAerodromeExport();

  return success(c, geojson, {
    message: "Successfully retrieved aerodrome features",
  });
});
