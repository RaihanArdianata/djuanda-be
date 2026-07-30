import { logger } from "@repo/logger";
import { env } from "@/config/env";
import type { JsonRecord, JsonValue } from "../lib/json";
import { fetchWithRetry } from "../lib/retry";

export interface MetarCloudLayer {
  cover: string;
  base: number | null;
}

export interface MetarProviderItem {
  icaoId: string;
  receiptTime: string;
  obsTime: number;
  reportTime: string;
  temp: number | null;
  dewp: number | null;
  wdir: number | string | null;
  wspd: number | null;
  wgst: number | null;
  visib: string | number;
  altim: number | null;
  metarType: string;
  rawOb: string;
  clouds: MetarCloudLayer[];
}

const isMetarProviderItem = (value: object): value is MetarProviderItem => {
  const candidate = value as JsonRecord;
  return (
    typeof candidate.icaoId === "string" &&
    typeof candidate.rawOb === "string" &&
    typeof candidate.obsTime === "number" &&
    typeof candidate.metarType === "string"
  );
};

export const fetchLatestMetar = async (
  icao: string,
): Promise<MetarProviderItem | null> => {
  const url = `${env.AVIATIONWEATHER_BASE_URL}/metar?ids=${icao}&format=json`;

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
    logger.warn({ icao }, "metar provider returned an empty payload");
    return null;
  }

  const [latest] = body;

  if (
    typeof latest !== "object" ||
    latest === null ||
    Array.isArray(latest) ||
    !isMetarProviderItem(latest)
  ) {
    logger.warn({ icao }, "metar provider payload shape was unexpected");
    return null;
  }

  return latest;
};