export interface NotamSourceItem {
  header?: unknown;
  msg_id?: unknown;
  fir?: unknown;
  qcode?: unknown;
  traffic?: unknown;
  purpose?: unknown;
  scope?: unknown;
  lower_limit?: unknown;
  upper_limit?: unknown;
  coordinates?: unknown;
  location?: unknown;
  effective_time?: unknown;
  expiration_time?: unknown;
  schedule?: unknown;
  remark?: unknown;
  lower_altitude_limit?: unknown;
  upper_altitude_limit?: unknown;
  raw?: unknown;
  [key: string]: unknown;
}

export type NotamType = "NOTAMN" | "NOTAMR" | "NOTAMC";

export interface NormalizedNotamMessage {
  providerId: string;

  header: string | null;

  series: string;
  number: string;
  year: number;
  type: NotamType;

  fir: string | null;
  icaoLocation: string;
  qcode: string | null;
  traffic: string | null;
  purpose: string | null;
  scope: string | null;
  lowerLimit: string | null;
  upperLimit: string | null;
  coordinates: string | null;

  effectiveFrom: Date;
  effectiveTo: Date;
  schedule: string | null;

  lowerAltitude: string | null;
  upperAltitude: string | null;

  subject: string | null;
  body: string;

  raw: unknown;
}

export const cleanField = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\r\n/g, "\n").trim();

  return trimmed.length === 0 ? null : trimmed;
};

export const cleanSingleLineField = (value: unknown): string | null => {
  const cleaned = cleanField(value);
  return cleaned === null ? null : cleaned.replace(/\s+/g, " ").trim();
};

export const parseNotamDatetime = (value: unknown): Date | null => {
  const raw = cleanSingleLineField(value);
  if (!raw) {
    return null;
  }

  const isoLike = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)
    ? `${raw.replace(" ", "T")}${raw.length === 16 ? ":00" : ""}Z`
    : raw;

  const date = new Date(isoLike);
  return Number.isNaN(date.getTime()) ? null : date;
};

const MSG_ID_PATTERN = /^([A-Z])(\d{4,})\/(\d{2})\s+(NOTAMN|NOTAMR|NOTAMC)$/i;

export interface ParsedNotamMsgId {
  providerId: string;
  series: string;
  number: string;
  year: number;
  type: NotamType;
}

export const parseNotamMsgId = (value: unknown): ParsedNotamMsgId | null => {
  const cleaned = cleanSingleLineField(value);
  if (!cleaned) {
    return null;
  }

  const match = MSG_ID_PATTERN.exec(cleaned);
  if (!match) {
    return null;
  }

  const [, series, number, yearSuffix, type] = match;
  if (!series || !number || !yearSuffix || !type) {
    return null;
  }

  return {
    providerId: cleaned,
    series: series.toUpperCase(),
    number,
    year: 2000 + Number.parseInt(yearSuffix, 10),
    type: type.toUpperCase() as NotamType,
  };
};
