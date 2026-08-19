import type { AftnProviderItem } from "../../provider/aftn.provider";
import {
  extractRawKeyValues,
  type NormalizedAftnMessage,
  normalizeCommonFields,
} from "./common";

export const parseDla = (
  item: AftnProviderItem,
  datetime: Date,
): NormalizedAftnMessage => {
  const message = normalizeCommonFields(item, "DLA", datetime);
  const rawFields = extractRawKeyValues(message.raw);

  message.parsed = {
    ...(rawFields.DOF && { dof: rawFields.DOF }),
    ...(rawFields.RMK && { remark: rawFields.RMK }),
    ...(message.departureTime && {
      delayedDepartureTime: message.departureTime,
    }),
  };

  return message;
};
