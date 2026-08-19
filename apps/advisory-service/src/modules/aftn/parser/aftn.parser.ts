import type { AftnProviderItem } from "../../provider/aftn.provider";
import { parseArr } from "./arr.parser";
import { parseChg } from "./chg.parser";
import {
  cleanField,
  extractMessageTypeFromRaw,
  type NormalizedAftnMessage,
  normalizeCommonFields,
  parseProviderDatetime,
} from "./common";
import { parseDep } from "./dep.parser";
import { parseDla } from "./dla.parser";
import { parseFpl } from "./fpl.parser";

export type AftnParser = (
  item: AftnProviderItem,
  datetime: Date,
) => NormalizedAftnMessage;

const PARSERS: Record<string, AftnParser> = {
  FPL: parseFpl,
  DEP: parseDep,
  ARR: parseArr,
  DLA: parseDla,
  CHG: parseChg,
};

export const SUPPORTED_MESSAGE_TYPES = Object.keys(PARSERS);

export const detectMessageType = (item: AftnProviderItem): string | null => {
  const fromProvider = cleanField(item.message_type);
  if (fromProvider) {
    return fromProvider.toUpperCase();
  }

  const raw = cleanField(item.raw);
  return raw ? extractMessageTypeFromRaw(raw.toUpperCase()) : null;
};

export const isSupportedMessageType = (messageType: string): boolean =>
  Object.hasOwn(PARSERS, messageType);

export interface AftnParseFailure {
  ok: false;
  reason: string;
}

export interface AftnParseSuccess {
  ok: true;
  message: NormalizedAftnMessage;

  parserSupported: boolean;
}

export type AftnParseResult = AftnParseSuccess | AftnParseFailure;

export const parseAftnMessage = (item: AftnProviderItem): AftnParseResult => {
  const messageType = detectMessageType(item);
  if (!messageType) {
    return { ok: false, reason: "message_type is missing and unresolvable" };
  }

  const datetime = parseProviderDatetime(item.datetime);
  if (!datetime) {
    return { ok: false, reason: "datetime is missing or invalid" };
  }

  if (!cleanField(item.raw)) {
    return { ok: false, reason: "raw message is missing" };
  }

  const parser = PARSERS[messageType];

  if (!parser) {
    return {
      ok: true,
      parserSupported: false,
      message: normalizeCommonFields(item, messageType, datetime),
    };
  }

  return {
    ok: true,
    parserSupported: true,
    message: parser(item, datetime),
  };
};
