import { env } from "@/config/env";

export const isObservationStale = (observedAt: Date): boolean => {
  const staleAfterMs = env.OBSERVATION_STALE_MINUTES * 60 * 1000;
  return Date.now() - observedAt.getTime() > staleAfterMs;
};

export const isForecastStale = (validTo: Date): boolean => {
  return Date.now() > validTo.getTime();
};
