import { logger } from "@repo/logger";
import { env } from "@/config/env";
import type { JsonRecord, JsonValue } from "../lib/json";
import { fetchWithRetry } from "../lib/retry";

interface BmkgObservationRecord {
  data_code?: string;
  icao_code?: string;
  observed_time?: string;
  data_text?: string;
  insert_time?: string;
}

interface BmkgTafRecord extends BmkgObservationRecord {
  issued_time?: string;
  valid_from?: string;
  valid_until?: string;
}

export interface BmkgObservationItem {
  icaoId: string;
  obsTime: number;
  rawOb: string;
  reportId: string;
  providerRaw: Record<string, unknown>;
}

export interface BmkgTafItem {
  icaoId: string;
  issueTime: string;
  validTimeFrom: number;
  validTimeTo: number;
  rawTaf: string;
  reportId: string;
  providerRaw: Record<string, unknown>;
}

const isRecord = (value: JsonValue): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseUtc = (value: string): number => {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp))
    throw new Error(`Invalid BMKG timestamp: ${value}`);
  return timestamp;
};

const getRecords = (body: JsonValue, icao: string): JsonRecord[] => {
  if (!isRecord(body)) return [];
  const records = body[icao];
  return Array.isArray(records)
    ? records.filter((item): item is JsonRecord => isRecord(item))
    : [];
};

const fetchRecords = async (path: string): Promise<JsonRecord[]> => {
  if (!env.BMKG_API_TOKEN) {
    logger.warn("BMKG API token is not configured");
    return [];
  }

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${env.BMKG_API_TOKEN}`);

  const response = await fetchWithRetry(
    `${env.BMKG_API_BASE_URL}/${path}/${env.WEATHER_STATION_ICAO}`,
    {
      headers,
      method: "GET",
    },
    {
      timeoutMs: env.PROVIDER_TIMEOUT_MS,
      maxRetries: env.PROVIDER_MAX_RETRIES,
      baseDelayMs: env.PROVIDER_RETRY_BASE_DELAY_MS,
    },
  );

  if (!response) return [];
  const body: JsonValue = await response.json();
  return getRecords(body, env.WEATHER_STATION_ICAO);
};

const observation = (
  item: BmkgObservationRecord,
): BmkgObservationItem | null => {
  if (
    typeof item.icao_code !== "string" ||
    typeof item.observed_time !== "string" ||
    typeof item.data_text !== "string"
  )
    return null;

  return {
    icaoId: item.icao_code,
    obsTime: parseUtc(item.observed_time),
    rawOb: item.data_text,
    reportId: item.data_code ?? `${item.icao_code}:${item.observed_time}`,
    providerRaw: { ...item },
  };
};

export const fetchLatestBmkgMetar =
  async (): Promise<BmkgObservationItem | null> => {
    const records = (await fetchRecords("metar"))
      .map((item) => observation(item))
      .filter((item): item is BmkgObservationItem => item !== null)
      .sort((a, b) => b.obsTime - a.obsTime);
    return records[0] ?? null;
  };

export const fetchLatestBmkgSpeci =
  async (): Promise<BmkgObservationItem | null> => {
    const records = (await fetchRecords("speci"))
      .map((item) => observation(item))
      .filter((item): item is BmkgObservationItem => item !== null)
      .sort((a, b) => b.obsTime - a.obsTime);
    return records[0] ?? null;
  };

const taf = (item: BmkgTafRecord): BmkgTafItem | null => {
  if (
    typeof item.icao_code !== "string" ||
    typeof item.issued_time !== "string" ||
    typeof item.valid_from !== "string" ||
    typeof item.valid_until !== "string" ||
    typeof item.data_text !== "string"
  )
    return null;

  return {
    icaoId: item.icao_code,
    issueTime: new Date(parseUtc(item.issued_time)).toISOString(),
    validTimeFrom: parseUtc(item.valid_from),
    validTimeTo: parseUtc(item.valid_until),
    rawTaf: item.data_text,
    reportId: item.data_code ?? `${item.icao_code}:${item.issued_time}`,
    providerRaw: { ...item },
  };
};

export const fetchLatestBmkgTaf = async (): Promise<BmkgTafItem | null> => {
  const records = (await fetchRecords("taf"))
    .map((item) => taf(item as BmkgTafRecord))
    .filter((item): item is BmkgTafItem => item !== null)
    .sort((a, b) => b.validTimeTo - a.validTimeTo);
  return records[0] ?? null;
};
