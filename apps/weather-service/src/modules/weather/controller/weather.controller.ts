import { ApiError, catchAsync, success } from "@repo/shared";
import {
  getActiveForecast,
  getCurrentObservation,
  getObservationHistory,
  getObservationHistoryCount,
} from "../services/weather.service";
import type {
  GetCurrentObservationParams,
  GetForecastParams,
  GetObservationHistoryParams,
} from "../validator/weather.validator";

export const getCurrent = catchAsync(async (c) => {
  const parsedData = c.get("parsedData") as GetCurrentObservationParams;

  const result = await getCurrentObservation(parsedData.station);

  if (!result) {
    throw new ApiError("NOT_FOUND", {
      message: "No METAR observation has been recorded for this station yet",
    });
  }

  return success(c, result, {
    message: "Current weather observation fetched successfully",
  });
});

export const getHistory = catchAsync(async (c) => {
  const parsedData = c.get("parsedData") as GetObservationHistoryParams;

  const results = await getObservationHistory(parsedData);
  const total = await getObservationHistoryCount(parsedData);
  const totalPages = Math.ceil(total / parsedData.size);

  return success(
    c,
    results,
    { message: "Weather observation history fetched successfully" },
    {
      page: parsedData.page,
      size: parsedData.size,
      total,
      totalPages,
    },
  );
});

export const getForecast = catchAsync(async (c) => {
  const parsedData = c.get("parsedData") as GetForecastParams;

  const result = await getActiveForecast(parsedData.station);

  if (!result) {
    throw new ApiError("NOT_FOUND", {
      message: "No TAF forecast has been recorded for this station yet",
    });
  }

  return success(c, result, {
    message: "Weather forecast fetched successfully",
  });
});
