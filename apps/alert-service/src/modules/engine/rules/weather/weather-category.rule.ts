import { type FlightCategory, flightCategory } from "@aeroswarm/weather";
import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";
import {
  forecastHoursOf,
  forecastSamples,
  readWeather,
  utcClock,
  weatherCandidate,
} from "./weather.helpers";

const RANK: Record<FlightCategory, number> = {
  LIFR: 0,
  IFR: 1,
  MVFR: 2,
  VFR: 3,
};

const isCategory = (value: unknown): value is FlightCategory =>
  typeof value === "string" && value in RANK;

/**
 * Kategori penerbangan turun ke `alertFrom` atau lebih buruk (mis. `IFR`: memicu pada IFR dan LIFR).
 * `alertFrom` tidak punya bawaan; tanpa itu rule tidak menghasilkan apa-apa. Pengamatan = CRITICAL;
 * TAF memprakirakan dalam `forecastHours` jam = WARNING. Ambang kategori mengikuti definisi FAA.
 */
export const weatherCategoryRule: DetectionRule = {
  type: "WEATHER_CATEGORY_DROP",
  needs: ["weather"],
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const alertFrom = config.alertFrom;
    if (!isCategory(alertFrom)) return [];
    const reading = readWeather(ctx, config);
    if (!reading) return [];
    const { station, observation, forecast } = reading;
    const hit = (category: FlightCategory | null): category is FlightCategory =>
      category !== null && RANK[category] <= RANK[alertFrom];

    if (observation) {
      const result = flightCategory(observation.conditions);
      if (hit(result.category)) {
        return [
          weatherCandidate({
            ctx,
            type: "WEATHER_CATEGORY_DROP",
            station,
            kind: "observed",
            severity: "CRITICAL",
            message: `${station} flight category ${result.category} (${observation.kind} ${utcClock(observation.observedAt)})`,
            details: {
              category: result.category,
              alertFrom,
              visibilityM: result.visibilityM,
              ceilingFt: result.ceilingFt,
              limitedBy: result.limitedBy,
              source: observation.kind,
              observedAt: observation.observedAt.toISOString(),
              raw: observation.raw,
            },
            occursAt: observation.observedAt,
          }),
        ];
      }
    }

    if (forecast) {
      for (const sample of forecastSamples(
        forecast,
        ctx.timestamp,
        forecastHoursOf(config),
      )) {
        const result = flightCategory(sample.conditions);
        if (!hit(result.category)) continue;
        return [
          weatherCandidate({
            ctx,
            type: "WEATHER_CATEGORY_DROP",
            station,
            kind: "forecast",
            severity: "WARNING",
            message: `${station} forecast flight category ${result.category} from ${utcClock(sample.at)} (TAF)`,
            details: {
              category: result.category,
              alertFrom,
              visibilityM: result.visibilityM,
              ceilingFt: result.ceilingFt,
              limitedBy: result.limitedBy,
              source: "TAF",
              raw: forecast.raw,
            },
            occursAt: sample.at,
          }),
        ];
      }
    }
    return [];
  },
};
