import type { AftnParsedExtras } from "@repo/database";
import type { AftnProviderItem } from "../../provider/aftn.provider";

export interface NormalizedAftnMessage {
  datetime: Date;
  messageType: string;
  callSign: string | null;
  registration: string | null;
  aircraftType: string | null;
  departure: string | null;
  departureTime: string | null;
  destination: string | null;
  destinationTime: string | null;
  duration: string | null;
  speed: string | null;
  altitude: string | null;
  route: string | null;
  raw: string;

  parsed: AftnParsedExtras;
}

export const cleanField = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "-") {
    return null;
  }

  return trimmed;
};

const uppercase = (value: string | null): string | null =>
  value === null ? null : value.toUpperCase();

export const parseProviderDatetime = (value: unknown): Date | null => {
  const raw = cleanField(value);
  if (!raw) {
    return null;
  }

  const isoLike = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)
    ? `${raw.replace(" ", "T")}${raw.length === 16 ? ":00" : ""}Z`
    : raw;

  const date = new Date(isoLike);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const normalizeCommonFields = (
  item: AftnProviderItem,
  messageType: string,
  datetime: Date,
): NormalizedAftnMessage => ({
  datetime,
  messageType,
  callSign: uppercase(cleanField(item.call_sign)),
  registration: uppercase(cleanField(item.registration)),
  aircraftType: uppercase(cleanField(item.aircraft_type)),
  departure: uppercase(cleanField(item.departure)),
  departureTime: cleanField(item.departure_time),
  destination: uppercase(cleanField(item.destination)),
  destinationTime: cleanField(item.destination_time),
  duration: cleanField(item.duration),
  speed: uppercase(cleanField(item.speed)),
  altitude: uppercase(cleanField(item.altitude)),
  route: cleanField(item.route),
  raw: cleanField(item.raw) ?? "",
  parsed: {},
});

export const extractRawKeyValues = (raw: string): Record<string, string> => {
  const result: Record<string, string> = {};
  if (!raw) {
    return result;
  }

  const pattern =
    /\b([A-Z]{3,4})\/([^/)]+?)(?=\s+[A-Z]{3,4}\/|-\d{1,2}\/|\s*\)|\s*$)/g;

  for (const match of raw.matchAll(pattern)) {
    const key = match[1];
    const value = match[2];
    if (key && value && result[key] === undefined) {
      result[key] = value.trim();
    }
  }

  return result;
};

export const extractMessageTypeFromRaw = (raw: string): string | null => {
  const match = /\(\s*([A-Z]{3})\b/.exec(raw);
  return match?.[1] ?? null;
};
