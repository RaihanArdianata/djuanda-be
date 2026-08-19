import type { AftnProviderItem } from "../../provider/aftn.provider";
import {
  cleanField,
  extractRawKeyValues,
  type NormalizedAftnMessage,
  normalizeCommonFields,
} from "./common";

export const parseFpl = (
  item: AftnProviderItem,
  datetime: Date,
): NormalizedAftnMessage => {
  const message = normalizeCommonFields(item, "FPL", datetime);
  const rawFields = extractRawKeyValues(message.raw);

  message.registration =
    message.registration ?? cleanField(rawFields.REG)?.toUpperCase() ?? null;

  message.parsed = {
    ...(rawFields.PBN && { pbn: rawFields.PBN }),
    ...(rawFields.NAV && { nav: rawFields.NAV }),
    ...(rawFields.DOF && { dof: rawFields.DOF }),
    ...(rawFields.REG && { registration: rawFields.REG }),
    ...(rawFields.EET && { eet: rawFields.EET }),
    ...(rawFields.SEL && { selcal: rawFields.SEL }),
    ...(rawFields.CODE && { code: rawFields.CODE }),
    ...(rawFields.OPR && { operator: rawFields.OPR }),
    ...(rawFields.RMK && { remark: rawFields.RMK }),
    ...(rawFields.DEST && { alternate: rawFields.DEST }),
  };

  return message;
};
