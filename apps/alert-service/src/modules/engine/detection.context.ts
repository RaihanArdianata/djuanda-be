import { logger } from "@repo/logger";
import {
  getAftnContext,
  getNotamContext,
} from "../../context/advisory.context";
import { getAerodromeContext } from "../../context/aerodrome.context";
import { getWeatherContext } from "../../context/weather.context";
import type {
  AerodromeContextData,
  AlertContext,
  ContextNeed,
  MovementTrack,
} from "./types";

export interface BuildDetectionContextInput {
  airportId: string;
  timestamp: Date;
  tracks: MovementTrack[];
}

function pick<T>(
  result: PromiseSettledResult<T>,
  source: string,
  airportId: string,
): T | null {
  if (result.status === "rejected") {
    logger.warn(
      { err: result.reason, airportId, source },
      "alert context source failed — rules needing it are skipped",
    );
    return null;
  }
  return result.value;
}

/** Context bersifat opsional per-rule — kegagalan satu sumber (misal
 *  advisory-service down) tidak boleh mematikan seluruh evaluasi. */
export async function buildAlertContext(
  input: BuildDetectionContextInput,
  aerodromePromise?: Promise<AerodromeContextData | null>,
  needs: ReadonlySet<ContextNeed> = new Set(),
): Promise<AlertContext> {
  const [weather, aerodrome, aftn, notam] = await Promise.allSettled([
    needs.has("weather") ? getWeatherContext(input.airportId) : null,
    aerodromePromise ?? getAerodromeContext(input.airportId, input.tracks),
    needs.has("aftn") ? getAftnContext(input.airportId) : null,
    needs.has("notam") ? getNotamContext(input.airportId) : null,
  ]);

  return {
    airportId: input.airportId,
    timestamp: input.timestamp,
    tracks: input.tracks,
    weather: pick(weather, "weather", input.airportId),
    aerodrome: pick(aerodrome, "aerodrome", input.airportId),
    aftn: pick(aftn, "aftn", input.airportId),
    notam: pick(notam, "notam", input.airportId),
  };
}
