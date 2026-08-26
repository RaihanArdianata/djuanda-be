import {
  type AshtamSourceItem,
  cleanField,
  cleanSingleLineField,
  type NormalizedAshtamMessage,
  parseAshtamDatetime,
  parseAshtamNumber,
} from "./common";

export interface AshtamParseFailure {
  ok: false;
  reason: string;
}

export interface AshtamParseSuccess {
  ok: true;
  message: NormalizedAshtamMessage;
}

export type AshtamParseResult = AshtamParseSuccess | AshtamParseFailure;

/**
 * provider/source item → validate required fields → clean/normalize →
 * parse datetime → extract ASHTAM number → normalized ASHTAM.
 *
 * Mapping follows BE-ASHTAM.pdf exactly:
 *   header                     → header
 *   msg_id                     → providerId / number
 *   affected_fir               → affectedFir
 *   start_datetime             → effectiveFrom
 *   end_datetime               → effectiveTo
 *   volcano_name               → volcanoName
 *   volcano_latitude_longitude → volcanoCoordinates
 *   colour_code                → colourCode
 *   volcanic_ash               → volcanicAsh
 *   volcanic_ash_direction     → volcanicAshDirection
 *   air_routes_affected        → airRoutesAffected
 *   air_routes_closure         → airRoutesClosure
 *   information_source         → informationSource
 *   remark                     → remark
 *   raw                        → raw
 *
 * Deliberately does NOT invent values (e.g. a "year") that the source doesn't
 * provide — per the source document, fields with no data stay `null`.
 */
export const parseAshtamMessage = (
  item: AshtamSourceItem,
): AshtamParseResult => {
  const number = parseAshtamNumber(item.msg_id);
  if (!number) {
    return {
      ok: false,
      reason: `msg_id is missing or does not match the expected "ASHTAM <number>" format (got: ${JSON.stringify(item.msg_id)})`,
    };
  }

  const affectedFir = cleanSingleLineField(item.affected_fir);
  if (!affectedFir) {
    return { ok: false, reason: "affected_fir is missing" };
  }

  const effectiveFrom = parseAshtamDatetime(item.start_datetime);
  if (!effectiveFrom) {
    return {
      ok: false,
      reason: `start_datetime is missing or invalid (got: ${JSON.stringify(item.start_datetime)})`,
    };
  }

  const effectiveTo = parseAshtamDatetime(item.end_datetime);
  if (!effectiveTo) {
    return {
      ok: false,
      reason: `end_datetime is missing or invalid (got: ${JSON.stringify(item.end_datetime)})`,
    };
  }

  const raw = cleanField(item.raw);
  if (!raw) {
    return { ok: false, reason: "raw message is missing" };
  }

  const message: NormalizedAshtamMessage = {
    type: "ASHTAM",
    providerId: number.providerId,
    number: number.number,

    header: cleanSingleLineField(item.header),
    affectedFir,

    effectiveFrom,
    effectiveTo,

    volcanoName: cleanSingleLineField(item.volcano_name),
    volcanoCoordinates: cleanSingleLineField(item.volcano_latitude_longitude),
    colourCode: cleanSingleLineField(item.colour_code)?.toUpperCase() ?? null,
    volcanicAsh: cleanField(item.volcanic_ash),
    volcanicAshDirection: cleanSingleLineField(item.volcanic_ash_direction),
    airRoutesAffected: cleanField(item.air_routes_affected),
    airRoutesClosure: cleanField(item.air_routes_closure),
    informationSource: cleanSingleLineField(item.information_source),
    remark: cleanField(item.remark),

    raw,
  };

  return { ok: true, message };
};
