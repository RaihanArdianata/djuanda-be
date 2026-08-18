import { ApiError, catchAsync, success } from "@repo/shared";
import { getOperationalStatistics } from "../service/statistics.service";
import type { GetOperationalStatisticsParams } from "../validator/statistics.validator";

export const getOperational = catchAsync(async (c) => {
  const params = c.get("parsedData") as GetOperationalStatisticsParams;
  if (params.startDate > params.endDate) {
    throw new ApiError("INVALID_DATE_RANGE");
  }
  const result = await getOperationalStatistics(params);
  return success(c, result, {
    message: "Operational statistics retrieved successfully",
  });
});
