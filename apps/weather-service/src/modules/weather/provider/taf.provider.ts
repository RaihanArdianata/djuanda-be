import { logger } from "@repo/logger";
import { env } from "@/config/env";
import type { JsonRecord, JsonValue } from "../lib/json";
import { fetchWithRetry } from "../lib/retry";

export interface TafProviderCloudLayer {
  cover: string;
  base: number | null;
  type: string | null;
}

export interface TafProviderForecastPeriod {
  timeFrom: number;
  timeTo: number;
  timeBec: number | null;
  fcstChange: string | null;
  probability: number | null;
  wdir: number | string | null;
  wspd: number | null;
  wgst: number | null;
  visib: string | number;
  wxString: string | null;
  clouds: TafProviderCloudLayer[];
}

export interface TafProviderItem {
  icaoId: string;
  bulletinTime: string;
  issueTime: string;
  validTimeFrom: number;
  validTimeTo: number;
  // biome-ignore lint/style/useNamingConvention: The property name is based on the provider's API response.
  rawTAF: string;
  fcsts: TafProviderForecastPeriod[];
}

const isTafProviderItem = (value: object): value is TafProviderItem => {
  const candidate = value as JsonRecord;
  return (
    typeof candidate.icaoId === "string" &&
    typeof candidate.rawTAF === "string" &&
    typeof candidate.validTimeFrom === "number" &&
    typeof candidate.validTimeTo === "number" &&
    Array.isArray(candidate.fcsts)
  );
};

export const fetchLatestTaf = async (
  icao: string,
): Promise<TafProviderItem | null> => {
  const url = `${env.AVIATIONWEATHER_BASE_URL}/taf?ids=${icao}&format=json`;

  const response = await fetchWithRetry(
    url,
    { method: "GET" },
    {
      timeoutMs: env.PROVIDER_TIMEOUT_MS,
      maxRetries: env.PROVIDER_MAX_RETRIES,
      baseDelayMs: env.PROVIDER_RETRY_BASE_DELAY_MS,
    },
  );

  if (!response) {
    return null;
  }

  const body: JsonValue = await response.json();

  if (!Array.isArray(body) || body.length === 0) {
    logger.warn({ icao }, "taf provider returned an empty payload");
    return null;
  }

  const [latest] = body;

  if (
    typeof latest !== "object" ||
    latest === null ||
    Array.isArray(latest) ||
    !isTafProviderItem(latest)
  ) {
    logger.warn({ icao }, "taf provider payload shape was unexpected");
    return null;
  }

  return latest;
};
