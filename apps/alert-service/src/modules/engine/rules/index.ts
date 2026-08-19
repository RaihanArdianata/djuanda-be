import type { DetectionRule } from "../types";
import { deviationRule } from "./deviation/deviation.rule";
import { areaPenetrationRule } from "./incursion/area-penetration.rule";
import { runwayIncursionRule } from "./incursion/runway-incursion.rule";
import { taxiwayApronIncursionRule } from "./incursion/taxiway-apron-incursion.rule";
import { stcaRule } from "./separation/stca.rule";

export const detectionRules: readonly DetectionRule[] = [
  stcaRule,
  areaPenetrationRule,
  deviationRule,
  runwayIncursionRule,
  taxiwayApronIncursionRule,
];
