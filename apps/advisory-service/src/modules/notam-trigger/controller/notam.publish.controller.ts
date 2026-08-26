import { ApiError, catchAsync, success } from "@repo/shared";
import { publishNotamEvent } from "../../messaging/advisory.producer";
import {
  notamPublishBodySchema,
  notamPublishQuerySchema,
} from "../validator/notam.publish.schema";

export const publishNotamEventController = catchAsync(async (c) => {
  const query = notamPublishQuerySchema.safeParse({
    airportId: c.req.query("airportId"),
  });

  if (!query.success) {
    throw new ApiError("BAD_REQUEST", {
      message: "airportId query is required",
    });
  }

  const bodyResult = notamPublishBodySchema.safeParse(
    await c.req.json().catch(() => ({})),
  );

  if (!bodyResult.success) {
    throw new ApiError("BAD_REQUEST", {
      message: bodyResult.error.issues.map((issue) => issue.message).join(", "),
    });
  }

  await publishNotamEvent(bodyResult.data.eventType, query.data.airportId);

  return success(
    c,
    {
      airportId: query.data.airportId,
      eventType: bodyResult.data.eventType,
      topic: "asmgcs.advisory",
    },
    {
      message: "NOTAM event published to Redpanda",
    },
  );
});
