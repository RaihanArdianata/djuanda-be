import ApiError from "@repo/shared/api-error";
import { success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  getActiveAshtamMessages,
  getAshtamHistories,
  getAshtamMessageById,
  getAshtamMessages,
  syncAshtam,
} from "../service/ashtam.service";
import { listAshtamQuerySchema } from "../validator/ashtam.query.schema";
import { ashtamSyncBodySchema } from "../validator/ashtam.sync.schema";

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

export const query = catchAsync(async (c) => {
  const parsed = listAshtamQuerySchema.safeParse(c.req.query());

  if (!parsed.success) {
    throw new ApiError("BAD_REQUEST", {
      message: parsed.error.issues.map((issue) => issue.message).join(", "),
    });
  }

  const result = await getAshtamMessages(parsed.data);

  return success(
    c,
    result.items,
    { message: "Successfully retrieved ASHTAM list" },
    {
      page: result.page,
      size: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    },
  );
});

/** "GET /api/v1/ashtams/active" from the spec — ready-to-use data for the
 * Volcanic Ash Warning banner, no expiry filtering needed on the consumer
 * side. */
export const active = catchAsync(async (c) => {
  const data = await getActiveAshtamMessages();

  return success(c, data, {
    message: "Successfully retrieved active ASHTAM",
  });
});

/** "GET /api/v1/ashtams/:id" from the spec. */
export const detail = catchAsync(async (c) => {
  const id = c.req.param("id");

  if (!id) {
    throw new ApiError("BAD_REQUEST", { message: "id is required" });
  }

  const data = await getAshtamMessageById(id);

  return success(c, data, {
    message: "Successfully retrieved ASHTAM detail",
  });
});

export const sync = catchAsync(async (c) => {
  const bodyResult = ashtamSyncBodySchema.safeParse(await c.req.json());

  if (!bodyResult.success) {
    throw new ApiError("BAD_REQUEST", {
      message: bodyResult.error.issues.map((issue) => issue.message).join(", "),
    });
  }

  const { start_date, end_date } = bodyResult.data;

  const result = await syncAshtam({
    startDate: new Date(start_date),
    endDate: new Date(end_date),
  });

  return success(c, result, {
    message: "ASHTAM synchronization completed",
  });
});
