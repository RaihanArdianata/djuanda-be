import { catchAsync, success } from "@repo/shared";
import { getAllAlerts } from "../service/alert.service";

export const getAlerts = catchAsync(async (c) => {
  const { airportId, page, size } = c.req.query();

  const filteringParams: Parameters<typeof getAllAlerts>[0] = {
    airportId,
    page: page ? parseInt(page, 10) : 1,
    size: size ? parseInt(size, 10) : 10,
  };

  const result = await getAllAlerts(filteringParams);
  return success(c, result, { message: "Alerts fetched successfully" });
});
