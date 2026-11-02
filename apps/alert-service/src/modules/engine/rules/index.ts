import type { DetectionRule } from "../types";
import { deviationRule } from "./deviation/deviation.rule";
import { areaPenetrationRule } from "./incursion/area-penetration.rule";
import { runwayIncursionRule } from "./incursion/runway-incursion.rule";
import { taxiwayApronIncursionRule } from "./incursion/taxiway-apron-incursion.rule";
import { stcaRule } from "./separation/stca.rule";
import { weatherCategoryRule } from "./weather/weather-category.rule";
import { weatherCrosswindRule } from "./weather/weather-crosswind.rule";
import { weatherMinimaRule } from "./weather/weather-minima.rule";
import { weatherThunderstormRule } from "./weather/weather-thunderstorm.rule";

export const detectionRules: readonly DetectionRule[] = [
  stcaRule,
  areaPenetrationRule,
  deviationRule,
  runwayIncursionRule,
  taxiwayApronIncursionRule,
  weatherMinimaRule,
  weatherCrosswindRule,
  weatherCategoryRule,
  weatherThunderstormRule,
];
