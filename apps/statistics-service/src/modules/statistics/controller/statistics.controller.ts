import ApiError from "@repo/shared/api-error";
import { success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import { getOperationalStatistics } from "../service/statistics.service";
import { exportOperationalReport } from "../service/statistics-export.service";
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

export const exportOperational = catchAsync(async (c) => {
  const params = c.get("parsedData") as GetOperationalStatisticsParams;
  if (params.startDate > params.endDate) {
    throw new ApiError("INVALID_DATE_RANGE");
  }
  const file = await exportOperationalReport(params);
  return new Response(file.data, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
