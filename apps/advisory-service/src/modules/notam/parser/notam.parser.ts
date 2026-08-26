import {
  cleanField,
  cleanSingleLineField,
  type NormalizedNotamMessage,
  type NotamSourceItem,
  parseNotamDatetime,
  parseNotamMsgId,
} from "./common";

export interface NotamParseFailure {
  ok: false;
  reason: string;
}

export interface NotamParseSuccess {
  ok: true;
  message: NormalizedNotamMessage;
}

export type NotamParseResult = NotamParseSuccess | NotamParseFailure;

export const parseNotamMessage = (item: NotamSourceItem): NotamParseResult => {
  const msgId = parseNotamMsgId(item.msg_id);
  if (!msgId) {
    return {
      ok: false,
      reason: `msg_id is missing or does not match the expected "<series><number>/<yy> NOTAM<N|R|C>" format (got: ${JSON.stringify(item.msg_id)})`,
    };
  }

  const icaoLocation = cleanSingleLineField(item.location);
  if (!icaoLocation) {
    return { ok: false, reason: "location is missing" };
  }

  const effectiveFrom = parseNotamDatetime(item.effective_time);
  if (!effectiveFrom) {
    return {
      ok: false,
      reason: `effective_time is missing or invalid (got: ${JSON.stringify(item.effective_time)})`,
    };
  }

  const effectiveTo = parseNotamDatetime(item.expiration_time);
  if (!effectiveTo) {
    return {
      ok: false,
      reason: `expiration_time is missing or invalid (got: ${JSON.stringify(item.expiration_time)})`,
    };
  }

  const body = cleanField(item.remark);
  if (!body) {
    return { ok: false, reason: "remark is missing" };
  }

  if (item.raw === undefined || item.raw === null) {
    return { ok: false, reason: "raw message is missing" };
  }

  const message: NormalizedNotamMessage = {
    providerId: msgId.providerId,
    header: cleanSingleLineField(item.header),

    series: msgId.series,
    number: msgId.number,
    year: msgId.year,
    type: msgId.type,

    fir: cleanSingleLineField(item.fir),
    icaoLocation,
    qcode: cleanSingleLineField(item.qcode),
    traffic: cleanSingleLineField(item.traffic),
    purpose: cleanSingleLineField(item.purpose),
    scope: cleanSingleLineField(item.scope),
    lowerLimit: cleanSingleLineField(item.lower_limit),
    upperLimit: cleanSingleLineField(item.upper_limit),
    coordinates: cleanSingleLineField(item.coordinates),

    effectiveFrom,
    effectiveTo,
    schedule: cleanField(item.schedule),

    lowerAltitude: cleanSingleLineField(item.lower_altitude_limit),
    upperAltitude: cleanSingleLineField(item.upper_altitude_limit),

    subject: null,
    body,

    raw: item.raw,
  };

  return { ok: true, message };
};
