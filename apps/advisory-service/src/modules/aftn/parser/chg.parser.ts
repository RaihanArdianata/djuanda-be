import type { AftnProviderItem } from "../../provider/aftn.provider";
import {
  cleanField,
  extractRawKeyValues,
  type NormalizedAftnMessage,
  normalizeCommonFields,
} from "./common";

export const parseChg = (
  item: AftnProviderItem,
  datetime: Date,
): NormalizedAftnMessage => {
  const message = normalizeCommonFields(item, "CHG", datetime);
  const rawFields = extractRawKeyValues(message.raw);
  const changes = extractChangeFields(message.raw);

  message.registration =
    message.registration ?? cleanField(rawFields.REG)?.toUpperCase() ?? null;

  message.parsed = {
    ...(rawFields.DOF && { dof: rawFields.DOF }),
    ...(rawFields.REG && { registration: rawFields.REG }),
    ...(rawFields.RMK && { remark: rawFields.RMK }),
    ...(changes.length > 0 && { changes }),
  };

  return message;
};

export interface AftnChangeField {
  field: string;
  value: string;
}

const extractChangeFields = (raw: string): AftnChangeField[] => {
  if (!raw) {
    return [];
  }

  const changes: AftnChangeField[] = [];
  const pattern = /-22\/(\d{1,2})-([^\-)\n]+)/g;

  for (const match of raw.matchAll(pattern)) {
    const field = match[1];
    const value = match[2];
    if (field && value) {
      changes.push({ field, value: value.trim() });
    }
  }

  return changes;
};
