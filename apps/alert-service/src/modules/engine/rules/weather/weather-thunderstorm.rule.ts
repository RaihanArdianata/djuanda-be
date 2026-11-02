import type { Conditions } from "@aeroswarm/weather";
import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";
import {
  forecastHoursOf,
  forecastSamples,
  readWeather,
  utcClock,
  weatherCandidate,
} from "./weather.helpers";

const overhead = (c: Conditions): boolean =>
  c.weather.some((w) => w.descriptor === "TS" && w.intensity !== "vicinity");

const nearby = (c: Conditions): boolean =>
  c.weather.some((w) => w.descriptor === "TS" && w.intensity === "vicinity") ||
  c.clouds.some((layer) => layer.type === "CB");

/**
 * Badai petir dan awan CB. Badai petir di bandara pada pengamatan = CRITICAL; badai di sekitar (VCTS)
 * atau awan CB pada pengamatan = WARNING; TAF memprakirakan badai petir atau CB dalam `forecastHours` jam
 * (bawaan 3) = WARNING. Tidak butuh ambang.
 */
export const weatherThunderstormRule: DetectionRule = {
  type: "WEATHER_THUNDERSTORM",
  needs: ["weather"],
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const reading = readWeather(ctx, config);
    if (!reading) return [];
    const { station, observation, forecast } = reading;
    const candidates: AlertCandidate[] = [];

    if (observation) {
      const when = `${observation.kind} ${utcClock(observation.observedAt)}`;
      const common = {
        source: observation.kind,
        observedAt: observation.observedAt.toISOString(),
        raw: observation.raw,
      };
      if (overhead(observation.conditions)) {
        candidates.push(
          weatherCandidate({
            ctx,
            type: "WEATHER_THUNDERSTORM",
            station,
            kind: "observed",
            severity: "CRITICAL",
            message: `${station} thunderstorm reported (${when})`,
            details: { weather: observation.conditions.weather, ...common },
            occursAt: observation.observedAt,
          }),
        );
      } else if (nearby(observation.conditions)) {
        candidates.push(
          weatherCandidate({
            ctx,
            type: "WEATHER_THUNDERSTORM",
            station,
            kind: "vicinity",
            severity: "WARNING",
            message: `${station} thunderstorm or cumulonimbus in the vicinity (${when})`,
            details: {
              weather: observation.conditions.weather,
              clouds: observation.conditions.clouds,
              ...common,
            },
            occursAt: observation.observedAt,
          }),
        );
      }
    }

    // Prakiraan hanya bila pengamatan belum menunjukkan badai atau CB (supaya tidak ganda).
    if (forecast && candidates.length === 0) {
      for (const sample of forecastSamples(
        forecast,
        ctx.timestamp,
        forecastHoursOf(config),
      )) {
        if (!overhead(sample.conditions) && !nearby(sample.conditions))
          continue;
        candidates.push(
          weatherCandidate({
            ctx,
            type: "WEATHER_THUNDERSTORM",
            station,
            kind: "forecast",
            severity: "WARNING",
            message: `${station} forecast thunderstorm or cumulonimbus from ${utcClock(sample.at)} (TAF)`,
            details: {
              weather: sample.conditions.weather,
              clouds: sample.conditions.clouds,
              source: "TAF",
              raw: forecast.raw,
            },
            occursAt: sample.at,
          }),
        );
        break;
      }
    }
    return candidates;
  },
};
