import ApiError from "@repo/shared/api-error";
import { failure, success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import {
  type DetectionResult,
  evaluateMovement,
} from "../../engine/alert.engine";
import {
  acknowledgeAlertService,
  clearAlertService,
  exportAlertsService,
  getActiveAlerts,
  getAlertById,
  getAlertTrackHistory,
  getAllAlerts,
} from "../service/alert.service";
import {
  acknowledgeAlertSchema,
  clearAlertSchema,
  detectSchema,
  exportAlertSchema,
  listAlertInputSchema,
} from "../validator/alert.validator";

export const listAlertsController = catchAsync(async (c) => {
  const query = c.req.query();
  const parsed = listAlertInputSchema.parse({
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
  const parsed = listAlertInputSchema.parse({
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
  const input = acknowledgeAlertSchema.parse(body);

  const alert = await acknowledgeAlertService(id, input);

  if (!alert) {
    return failure(c, 404, { code: "NOT_FOUND", message: "Alert not found" });
  }

  return success(c, alert, { message: "Alert acknowledged successfully" });
});

export const clearAlertController = catchAsync(async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const input = clearAlertSchema.parse(body);

  const alert = await clearAlertService(id, input);

  if (!alert) {
    return failure(c, 404, { code: "NOT_FOUND", message: "Alert not found" });
  }

  return success(c, alert, { message: "Alert cleared successfully" });
});

export const detectAlertController = catchAsync(async (c) => {
  const body = await c.req.json();
  const input = detectSchema.parse(body);

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
