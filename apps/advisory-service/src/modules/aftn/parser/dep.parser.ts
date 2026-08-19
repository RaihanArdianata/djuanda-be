import type { AftnProviderItem } from "../../provider/aftn.provider";
import {
  cleanField,
  extractRawKeyValues,
  type NormalizedAftnMessage,
  normalizeCommonFields,
} from "./common";

export const parseDep = (
  item: AftnProviderItem,
  datetime: Date,
): NormalizedAftnMessage => {
  const message = normalizeCommonFields(item, "DEP", datetime);
  const rawFields = extractRawKeyValues(message.raw);

  message.registration =
    message.registration ?? cleanField(rawFields.REG)?.toUpperCase() ?? null;

  message.parsed = {
    ...(rawFields.DOF && { dof: rawFields.DOF }),
    ...(rawFields.REG && { registration: rawFields.REG }),
    ...(rawFields.RMK && { remark: rawFields.RMK }),
  };

  return message;
};
