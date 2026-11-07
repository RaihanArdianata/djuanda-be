import ApiError from "@repo/shared/api-error";
import { failure, success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import { z } from "zod";
import {
  type DetectionResult,
  evaluateMovement,
} from "../../engine/alert.engine";
import {
  acknowledgeAlertService,
  bulkClearAlertsService,
  clearAlertService,
  deleteAlertService,
  exportAlertsService,
  getActiveAlerts,
  getAlertActionsService,
  getAlertById,
  getAlertTrackHistory,
  getAllAlerts,
  verifyAlertService,
} from "../service/alert.service";
import {
  acknowledgeAlertSchema,
  bulkClearAlertSchema,
  clearAlertSchema,
  deleteAlertSchema,
  detectSchema,
  exportAlertSchema,
  listAlertInputSchema,
  verifyAlertSchema,
} from "../validator/alert.validator";

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    const fields: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(fieldErrors)) {
      if (v) fields[k] = v as string[];
    }
    throw new ApiError("VALIDATION_ERROR", { fields });
  }
  return result.data;
}

const getActor = (c: {
  get: (key: string) => unknown;
}): { id?: string; name?: string; username?: string } => {
  const user = c.get("user") as
    | { id?: string; name?: string; username?: string }
    | undefined;
  const jwt = c.get("jwtPayload") as
    | { id?: string; username?: string; name?: string }
    | undefined;
  return {
    id: user?.id ?? jwt?.id,
    name: user?.name ?? jwt?.name,
    username: user?.username ?? jwt?.username,
  };
};

export const listAlertsController = catchAsync(async (c) => {
  const query = c.req.query();
  const parsed = parseOrThrow(listAlertInputSchema, {
    ...query,
    page: query.page,
    limit: query.limit ?? query.size,
  });

  const result = await getAllAlerts(parsed);
  return success(
    c,
    result.items,
    { message: "Alerts fetched successfully" },
    {
      page: parsed.page,
      size: parsed.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / parsed.limit),
    },
  );
});

export const listActiveAlertsController = catchAsync(async (c) => {
  const query = c.req.query();
  const parsed = parseOrThrow(listAlertInputSchema, {
    ...query,
    page: query.page,
    limit: query.limit ?? query.size,
  });

  const result = await getActiveAlerts(parsed);
  return success(
    c,
    result.items,
    { message: "Active alerts fetched successfully" },
    {
      page: parsed.page,
      size: parsed.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / parsed.limit),
    },
  );
});

export const getAlertByIdController = catchAsync(async (c) => {
  const { id } = c.req.param();
  const alert = await getAlertById(id);

  if (!alert) {
    return failure(c, 404, { code: "NOT_FOUND", message: "Alert not found" });
  }

  return success(c, alert, { message: "Alert fetched successfully" });
});

export const getAlertTrackHistoryController = catchAsync(async (c) => {
  const { id } = c.req.param();
  const result = await getAlertTrackHistory(id);
  return success(c, result, {
    message: "Alert track history fetched successfully",
  });
});

export const acknowledgeAlertController = catchAsync(async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const input = parseOrThrow(acknowledgeAlertSchema, body);
  const actor = getActor(c);

  const alert = await acknowledgeAlertService(id, input, actor);

  if (!alert) {
    return failure(c, 404, { code: "NOT_FOUND", message: "Alert not found" });
  }

  return success(c, alert, { message: "Alert acknowledged successfully" });
});

export const clearAlertController = catchAsync(async (c) => {
  const { id } = c.req.param();
  let body = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const input = parseOrThrow(clearAlertSchema, body);
  const actor = getActor(c);

  const alert = await clearAlertService(id, input, actor);

  if (!alert) {
    return failure(c, 404, { code: "NOT_FOUND", message: "Alert not found" });
  }

  return success(c, alert, { message: "Alert cleared successfully" });
});

export const bulkClearAlertController = catchAsync(async (c) => {
  const body = await c.req.json();
  const input = parseOrThrow(bulkClearAlertSchema, body);
  const actor = getActor(c);

  const result = await bulkClearAlertsService(input, actor);

  return success(c, result, { message: "Bulk clear processed successfully" });
});

export const verifyAlertController = catchAsync(async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const input = parseOrThrow(verifyAlertSchema, body);
  const actor = getActor(c);

  const alert = await verifyAlertService(id, input, actor);

  if (!alert) {
    return failure(c, 404, { code: "NOT_FOUND", message: "Alert not found" });
  }

  return success(c, alert, { message: "Alert verified successfully" });
});

export const getAlertActionsController = catchAsync(async (c) => {
  const { id } = c.req.param();
  const actions = await getAlertActionsService(id);

  if (!actions) {
    return failure(c, 404, { code: "NOT_FOUND", message: "Alert not found" });
  }

  return success(c, actions, {
    message: "Alert actions fetched successfully",
  });
});

export const deleteAlertController = catchAsync(async (c) => {
  const { id } = c.req.param();
  let body = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const input = parseOrThrow(deleteAlertSchema, body);
  const actor = getActor(c);

  const deleted = await deleteAlertService(id, input, actor);

  if (!deleted) {
    return failure(c, 404, { code: "NOT_FOUND", message: "Alert not found" });
  }

  return success(c, null, { message: "Alert deleted successfully" });
});

export const detectAlertController = catchAsync(async (c) => {
  const body = await c.req.json();
  const input = parseOrThrow(detectSchema, body);

  const result: DetectionResult = await evaluateMovement({
    airportId: input.airportId,
    timestamp: input.timestamp,
    tracks: input.tracks,
  });

  return success(c, result, { message: "Detection processed successfully" });
});

export const exportAlertsController = catchAsync(async (c) => {
  const query = c.req.query();
  const format = query.format?.toLowerCase();

  if (format !== "csv" && format !== "xlsx") {
    throw new ApiError("BAD_REQUEST", {
      message: "Invalid format. Supported formats are 'csv' or 'xlsx'",
    });
  }

  const startRaw = query.startDateTime ?? query.startDate;
  const endRaw = query.endDateTime ?? query.endDate;

  if (!startRaw || !endRaw) {
    throw new ApiError("BAD_REQUEST", {
      message: "startDateTime and endDateTime are required",
    });
  }

  const startDateTime = new Date(startRaw);
  const endDateTime = new Date(endRaw);

  if (
    Number.isNaN(startDateTime.getTime()) ||
    Number.isNaN(endDateTime.getTime()) ||
    startDateTime >= endDateTime
  ) {
    throw new ApiError("INVALID_DATE_RANGE", {
      message: "Start date must be before end date",
    });
  }

  const parsed = exportAlertSchema.parse({
    ...query,
    format,
    startDateTime,
    endDateTime,
  });

  // Extract auth token from request
  const authHeader = c.req.header("Authorization");
  const authToken = authHeader?.replace("Bearer ", "");

  const { filename, data, contentType } = await exportAlertsService(
    parsed,
    authToken,
  );
  const body = typeof data === "string" ? data : new Uint8Array(data);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
