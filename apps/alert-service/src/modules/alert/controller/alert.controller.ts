import { catchAsync, failure, success } from "@repo/shared";
import {
  type DetectionResult,
  evaluateMovement,
} from "../../engine/alert.engine";
import {
  acknowledgeAlertService,
  clearAlertService,
  getActiveAlerts,
  getAlertById,
  getAllAlerts,
} from "../service/alert.service";
import {
  acknowledgeAlertSchema,
  clearAlertSchema,
  detectSchema,
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
  return success(c, result, { message: "Alerts fetched successfully" });
});

export const listActiveAlertsController = catchAsync(async (c) => {
  const query = c.req.query();
  const parsed = listAlertInputSchema.parse({
    ...query,
    page: query.page,
    limit: query.limit ?? query.size,
  });

  const result = await getActiveAlerts(parsed);
  return success(c, result, { message: "Active alerts fetched successfully" });
});

export const getAlertByIdController = catchAsync(async (c) => {
  const { id } = c.req.param();
  const alert = await getAlertById(id);

  if (!alert) {
    return failure(c, 404, { code: "NOT_FOUND", message: "Alert not found" });
  }

  return success(c, alert, { message: "Alert fetched successfully" });
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
