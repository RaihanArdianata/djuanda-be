import ApiError from "@repo/shared/api-error";
import { success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import {
  getActiveForecast,
  getCurrentObservation,
  getLatestObservation,
  getObservationHistory,
  getObservationHistoryCount,
} from "../services/weather.service";
import { syncWeatherNow } from "../services/weather-poller";
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

  const { sync, ...data } = result;
  return success(c, data, {
    message: "Current weather observation fetched successfully",
    sync,
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

  const { sync, ...data } = result;
  return success(c, data, {
    message: "Weather forecast fetched successfully",
    sync,
  });
});

const getProductObservation = (kind: "METAR" | "SPECI"): typeof getCurrent =>
  catchAsync(async (c) => {
    const parsedData = c.get("parsedData") as GetCurrentObservationParams;
    const result = await getLatestObservation(parsedData.station, kind);

    if (!result) {
      throw new ApiError("NOT_FOUND", {
        message: `No ${kind} observation has been recorded for this station yet`,
      });
    }

    const { sync, ...data } = result;
    return success(c, data, {
      message: `${kind} weather observation fetched successfully`,
      sync,
    });
  });

export const getMetar = getProductObservation("METAR");
export const getSpeci = getProductObservation("SPECI");

export const syncWeather = catchAsync(async (c) => {
  const result = await syncWeatherNow();

  if (!result) {
    throw new ApiError("TOO_MANY_ATTEMPTS", {
      message: "Weather was just synced, try again in a few seconds",
    });
  }

  if (Object.values(result.results).some((status) => status === "failed")) {
    return c.json(
      {
        data: result.sync,
        error: {
          code: "WEATHER_PROVIDER_ERROR",
          message: result.sync.lastSyncError ?? "Weather provider failed",
        },
        meta: { code: 502, status: "ERROR" as const },
      },
      502,
    );
  }

  return success(
    c,
    {
      ...result.sync,
      retryAfterSec: result.retryAfterSec,
      results: result.results,
    },
    { message: "Weather sync finished" },
  );
});
