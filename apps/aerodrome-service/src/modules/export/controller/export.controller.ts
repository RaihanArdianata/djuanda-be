import { success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import { getAerodromeExport } from "../service/export.service";

export const get = catchAsync(async (c) => {
  const geojson = await getAerodromeExport();

  return success(c, geojson, {
    message: "Successfully retrieved aerodrome features",
  });
});
