import { ApiError, catchAsync, success } from "@repo/shared";
import { fetchAndTriggerNotams } from "../service/notam.trigger.service";
import {
  notamFetchBodySchema,
  notamFetchQuerySchema,
} from "../validator/notam.fetch.schema";

export const fetchNotamController = catchAsync(async (c) => {
  const query = notamFetchQuerySchema.safeParse({
    airportId: c.req.query("airportId"),
  });

  if (!query.success) {
    throw new ApiError("BAD_REQUEST", {
      message: "airportId query is required",
    });
  }

  const bodyResult = notamFetchBodySchema.safeParse(await c.req.json());

  if (!bodyResult.success) {
    throw new ApiError("BAD_REQUEST", {
      message: bodyResult.error.issues.map((issue) => issue.message).join(", "),
    });
  }

  const { start_date, end_date } = bodyResult.data;

  const result = await fetchAndTriggerNotams({
    airportId: query.data.airportId,
    startDate: new Date(start_date),
    endDate: new Date(end_date),
  });

  return success(c, result, {
    message: "NOTAM fetched from provider and taxiway status updated",
  });
});
