/**
 * Shape of one ASHTAM item as it comes out of a source/provider, before any
 * parsing or normalization. Both the mock JSON loader and (later) a real
 * provider adapter must produce this shape so the parser never needs to know
 * where the data came from.
 */
export interface AshtamSourceItem {
  header?: unknown;
  msg_id?: unknown;
  affected_fir?: unknown;
  start_datetime?: unknown;
  end_datetime?: unknown;
  volcano_name?: unknown;
  volcano_latitude_longitude?: unknown;
  colour_code?: unknown;
  volcanic_ash?: unknown;
  volcanic_ash_direction?: unknown;
  air_routes_affected?: unknown;
  air_routes_closure?: unknown;
  information_source?: unknown;
  remark?: unknown;
  raw?: unknown;
  [key: string]: unknown;
}

/**
 * ASHTAM after parsing/normalization — ready to hand to the repository.
 * Field names line up 1:1 with `ashtamMessages` columns (minus identity /
 * bookkeeping columns like `id`, `source`, `status`, `contentHash`, which the
 * repository fills in).
 */
export interface NormalizedAshtamMessage {
  type: "ASHTAM";
  providerId: string;
  number: number | null;

  header: string | null;
  affectedFir: string | null;

  effectiveFrom: Date;
  effectiveTo: Date;

  volcanoName: string | null;
  volcanoCoordinates: string | null;
  colourCode: string | null;
  volcanicAsh: string | null;
  volcanicAshDirection: string | null;
  airRoutesAffected: string | null;
  airRoutesClosure: string | null;
  informationSource: string | null;
  remark: string | null;

  raw: string;
}

/**
 * Trims a field and collapses it to `null` when empty. Deliberately does NOT
 * treat values like "NIL" as empty — those are meaningful aviation content,
 * not placeholders, and must be preserved as-is per the source document.
 */
export const cleanField = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  // Source data uses CRLF line endings inherited from the raw telex format;
  // normalize internal whitespace without discarding intentional content.
  const trimmed = value.replace(/\r\n/g, "\n").trim();

  return trimmed.length === 0 ? null : trimmed;
};

/** Like `cleanField`, but collapses all internal whitespace runs to a single space. */
export const cleanSingleLineField = (value: unknown): string | null => {
  const cleaned = cleanField(value);
  return cleaned === null ? null : cleaned.replace(/\s+/g, " ").trim();
};

/**
 * Parses ASHTAM's `YYYY-MM-DD HH:MM:SS` datetimes (UTC, per aviation
 * convention — the same assumption the AFTN parser makes for its datetimes).
 */
export const parseAshtamDatetime = (value: unknown): Date | null => {
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

const MSG_ID_PATTERN = /^ASHTAM\s+(\d+)$/i;

export interface ParsedAshtamNumber {
  providerId: string;
  number: number;
}

/**
 * Normalizes `msg_id` (e.g. `"ASHTAM 7836\r\n"`) into:
 *   providerId = "ASHTAM 7836"
 *   number     = 7836
 *
 * Returns `null` if `msg_id` doesn't match the expected `ASHTAM <number>`
 * shape — the caller must treat that as a validation failure rather than
 * inventing a number.
 */
export const parseAshtamNumber = (
  value: unknown,
): ParsedAshtamNumber | null => {
  const cleaned = cleanSingleLineField(value);
  if (!cleaned) {
    return null;
  }

  const match = MSG_ID_PATTERN.exec(cleaned);
  if (!match?.[1]) {
    return null;
  }

  return {
    providerId: `ASHTAM ${match[1]}`,
    number: Number.parseInt(match[1], 10),
  };
};
