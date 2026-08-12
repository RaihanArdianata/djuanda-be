import { ApiError, catchAsync, success } from "@repo/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { getAshtamHistories } from "../service/ashtam.service";

function _toContentfulStatus(status: number): ContentfulStatusCode {
  const isContentBearing =
    Number.isInteger(status) &&
    status >= 200 &&
    status < 600 &&
    status !== 204 &&
    status !== 304;

  return (isContentBearing ? status : 502) as ContentfulStatusCode;
}

const querySchema = z.object({
  "startDateTime.lessThan": z
    .string()
    .datetime({
      message:
        "startDateTime.lessThan harus format ISO 8601, contoh: 2026-04-21T00:00:00Z",
    })
    .optional(),
  size: z.coerce.number().int().positive().max(5000).optional(),
});

export const list = catchAsync(async (c) => {
  const parsed = querySchema.safeParse(c.req.query());

  if (!parsed.success) {
    throw new ApiError("BAD_REQUEST", {
      message: parsed.error.issues.map((i) => i.message).join(", "),
    });
  }

  const { size, "startDateTime.lessThan": startDateTimeLessThan } = parsed.data;

  const data = await getAshtamHistories({
    size,
    startDateTimeLessThan,
  });

  return success(c, data, {
    message: "Successfully retrieved ASHTAM histories",
  });
});
