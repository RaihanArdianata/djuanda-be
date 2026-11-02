import {
  evaluateMinima,
  type Minima,
  type MinimaReason,
} from "@aeroswarm/weather";
import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";
import {
  forecastHoursOf,
  forecastSamples,
  positive,
  readWeather,
  utcClock,
  weatherCandidate,
} from "./weather.helpers";

/** Hanya parameter yang diisi pengguna yang diperiksa; tanpa satu pun, rule ini tidak menghasilkan apa-apa. */
function minimaFrom(config: Record<string, unknown>): Minima | null {
  const minima: Minima = {};
  const visibilityM = positive(config.visibilityM);
  const ceilingFt = positive(config.ceilingFt);
  const rvrM = positive(config.rvrM);
  if (visibilityM !== undefined) minima.visibilityM = visibilityM;
  if (ceilingFt !== undefined) minima.ceilingFt = ceilingFt;
  if (rvrM !== undefined) {
    minima.rvrM = rvrM;
    if (Array.isArray(config.rvrRunways)) {
      const runways = config.rvrRunways.filter(
        (r): r is string => typeof r === "string",
      );
      if (runways.length > 0) minima.rvrRunways = runways;
    }
  }
  return Object.keys(minima).length === 0 ? null : minima;
}

const describe = (reason: MinimaReason): string => {
  switch (reason.kind) {
    case "visibility":
      return `visibility ${reason.value} m below ${reason.minimum} m`;
    case "ceiling":
      return `ceiling ${reason.value} ft below ${reason.minimum} ft`;
    case "rvr":
      return `RVR ${reason.runway ?? ""} ${reason.value} m below ${reason.minimum} m`.replace(
        "  ",
        " ",
      );
  }
};

/**
 * Cuaca di bawah minima yang ditentukan pengguna (jarak pandang, plafon, RVR). Pengamatan di bawah
 * minima = CRITICAL; bila pengamatan masih di atas tetapi TAF memprakirakan di bawah minima dalam
 * `forecastHours` jam (bawaan 3) = WARNING. Nilai minima tidak punya bawaan: diisi dari ketentuan bandara.
 * Data yang tidak ada tidak dianggap aman, tetapi juga tidak memicu alert.
 */
export const weatherMinimaRule: DetectionRule = {
  type: "WEATHER_MINIMA",
  needs: ["weather"],
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const minima = minimaFrom(config);
    const reading = minima ? readWeather(ctx, config) : null;
    if (!minima || !reading) return [];
    const { station, observation, forecast } = reading;

    if (observation) {
      const result = evaluateMinima(observation.conditions, minima);
      if (result.below) {
        const reasons = result.reasons.map(describe).join("; ");
        return [
          weatherCandidate({
            ctx,
            type: "WEATHER_MINIMA",
            station,
            kind: "observed",
            severity: "CRITICAL",
            message: `${station} below weather minima: ${reasons} (${observation.kind} ${utcClock(observation.observedAt)})`,
            details: {
              reasons: result.reasons,
              minima,
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
        const result = evaluateMinima(sample.conditions, minima);
        if (!result.below) continue;
        const reasons = result.reasons.map(describe).join("; ");
        return [
          weatherCandidate({
            ctx,
            type: "WEATHER_MINIMA",
            station,
            kind: "forecast",
            severity: "WARNING",
            message: `${station} forecast below weather minima from ${utcClock(sample.at)}: ${reasons} (TAF)`,
            details: {
              reasons: result.reasons,
              minima,
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
