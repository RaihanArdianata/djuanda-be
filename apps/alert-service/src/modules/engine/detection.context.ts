import { getAftnContext } from "../../context/advisory.context";
import { getAerodromeContext } from "../../context/aerodrome.context";
import { getWeatherContext } from "../../context/weather.context";
import type { AlertContext, MovementTrack } from "./types";

export interface BuildDetectionContextInput {
  airportId: string;
  timestamp: Date;
  tracks: MovementTrack[];
}

export async function buildAlertContext(
  input: BuildDetectionContextInput,
): Promise<AlertContext> {
  const [weather, aerodrome, aftn] = await Promise.all([
    getWeatherContext(input.airportId),
    getAerodromeContext(input.airportId),
    getAftnContext(input.airportId),
  ]);

  return {
    airportId: input.airportId,
    timestamp: input.timestamp,
    tracks: input.tracks,
    weather: weather ?? null,
    aerodrome: aerodrome ?? null,
    aftn: aftn ?? null,
  };
}
