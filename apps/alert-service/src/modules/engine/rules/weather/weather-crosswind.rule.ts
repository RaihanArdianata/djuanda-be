import {
  type RunwaySpec,
  runwayAdvice,
  runwayFromHeading,
  runwayFromPolygon,
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

interface RunwayConfig {
  designator: string;
  magneticHeadingDeg?: number;
}

/**
 * Runway yang ditinjau: daftar `runways` di konfigurasi bila ada (penunjuk dan heading magnetik),
 * selain itu runway aktif dari data aerodrome dengan heading dari sumbu panjang polygonnya. Angin METAR
 * dalam derajat true. Heading dari polygon sudah true; heading magnetik pada `runways` diubah menjadi
 * true dengan `variationEastDeg` (variasi magnetik, positif ke timur).
 */
function runwaysFrom(
  ctx: AlertContext,
  config: Record<string, unknown>,
): RunwaySpec[] {
  const variation =
    typeof config.variationEastDeg === "number" ? config.variationEastDeg : 0;
  if (Array.isArray(config.runways) && config.runways.length > 0) {
    return explicitRunways(config.runways as RunwayConfig[], variation);
  }
  return aerodromeRunways(ctx, config.onlyActiveRunways !== false, variation);
}

function explicitRunways(
  entries: RunwayConfig[],
  variation: number,
): RunwaySpec[] {
  const specs: RunwaySpec[] = [];
  for (const entry of entries) {
    if (typeof entry?.designator !== "string") continue;
    const heading =
      typeof entry.magneticHeadingDeg === "number"
        ? entry.magneticHeadingDeg
        : undefined;
    const spec = runwayFromHeading(entry.designator, heading, variation);
    if (spec) specs.push(spec);
  }
  return specs;
}

function aerodromeRunways(
  ctx: AlertContext,
  onlyActive: boolean,
  variation: number,
): RunwaySpec[] {
  const specs: RunwaySpec[] = [];
  for (const runway of ctx.aerodrome?.runways ?? []) {
    if (onlyActive && !runway.active) continue;
    const spec = runwayFromPolygon(
      runway.polygon.map(([lat, lon]) => ({ lat, lon })),
      variation,
    );
    if (spec) specs.push(spec);
  }
  return specs;
}

/**
 * Angin silang di runway melewati batas (`crosswindKt`, wajib diisi dari ketentuan bandara; tanpa itu
 * rule tidak menghasilkan apa-apa). Hembusan (gust) dihitung. Pengamatan melewati batas = CRITICAL;
 * TAF memprakirakan melewati batas dalam `forecastHours` jam = WARNING. Angin silang sama besarnya di kedua
 * arah runway, jadi arah yang dipakai tidak perlu diketahui.
 */
export const weatherCrosswindRule: DetectionRule = {
  type: "WEATHER_CROSSWIND",
  needs: ["weather"],
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const limit = positive(config.crosswindKt);
    if (limit === undefined) return [];
    const reading = readWeather(ctx, config);
    if (!reading) return [];
    const runways = runwaysFrom(ctx, config);
    if (runways.length === 0) return [];
    const { station, observation, forecast } = reading;

    const breaches = (wind: Parameters<typeof runwayAdvice>[0]) =>
      runwayAdvice(wind, runways, { crosswindKt: limit })
        .filter((advice) => advice.preferred.exceeds.crosswind === true)
        .map((advice) => ({
          runway: advice.runway.name,
          crosswindKt: (advice.preferred.gust ?? advice.preferred.steady)
            .crosswindKt,
          from: advice.preferred.steady.crosswindFrom,
        }));

    if (observation) {
      const found = breaches(observation.conditions.wind);
      if (found.length > 0) {
        const worst = found.reduce((a, b) =>
          b.crosswindKt > a.crosswindKt ? b : a,
        );
        return [
          weatherCandidate({
            ctx,
            type: "WEATHER_CROSSWIND",
            station,
            kind: "observed",
            severity: "CRITICAL",
            message: `${station} crosswind ${worst.crosswindKt} kt on runway ${worst.runway} exceeds limit ${limit} kt (${observation.kind} ${utcClock(observation.observedAt)})`,
            details: {
              runways: found,
              limitKt: limit,
              wind: observation.conditions.wind,
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
        const found = breaches(sample.conditions.wind);
        if (found.length === 0) continue;
        const worst = found.reduce((a, b) =>
          b.crosswindKt > a.crosswindKt ? b : a,
        );
        return [
          weatherCandidate({
            ctx,
            type: "WEATHER_CROSSWIND",
            station,
            kind: "forecast",
            severity: "WARNING",
            message: `${station} forecast crosswind ${worst.crosswindKt} kt on runway ${worst.runway} exceeds limit ${limit} kt from ${utcClock(sample.at)} (TAF)`,
            details: {
              runways: found,
              limitKt: limit,
              wind: sample.conditions.wind,
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
