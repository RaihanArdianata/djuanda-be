import { ApiError, catchAsync, success } from "@repo/shared";
import type { NotamSourceItem } from "../parser/common";
import { triggerNotams } from "../service/notam.trigger.service";
import {
  triggerNotamBodySchema,
  triggerNotamQuerySchema,
} from "../validator/notam.trigger.schema";

export const triggerNotamController = catchAsync(async (c) => {
  const query = triggerNotamQuerySchema.safeParse({
    airportId: c.req.query("airportId"),
  });

  if (!query.success) {
    throw new ApiError("BAD_REQUEST", {
      message: "airportId query is required",
    });
  }

  const bodyResult = triggerNotamBodySchema.safeParse(await c.req.json());

  if (!bodyResult.success) {
    throw new ApiError("BAD_REQUEST", {
      message: bodyResult.error.issues.map((issue) => issue.message).join(", "),
    });
  }

  const items = Array.isArray(bodyResult.data)
    ? (bodyResult.data as NotamSourceItem[])
    : [bodyResult.data as NotamSourceItem];

  const result = await triggerNotams({
    items,
    airportId: query.data.airportId,
  });

  return success(c, result, {
    message: "NOTAM triggered and taxiway status updated",
  });
});
