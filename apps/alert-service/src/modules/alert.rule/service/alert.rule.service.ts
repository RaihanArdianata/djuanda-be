import type { AlertRule } from "@repo/database";
import {
  createAlertRule,
  findAlertRuleById,
  type ListAlertRulesResult,
  listAlertRules,
  updateAlertRule,
} from "../repository/alert.rule.repository";
import type {
  CreateAlertRuleInput,
  ListAlertRulesInput,
  UpdateAlertRuleInput,
} from "../validator/alert.rule.validator";

export async function getAllAlertRules(
  params: ListAlertRulesInput,
): Promise<ListAlertRulesResult> {
  return listAlertRules(params);
}

export async function getAlertRuleById(
  id: string,
): Promise<AlertRule | undefined> {
  return findAlertRuleById(id);
}

export async function addAlertRule(
  input: CreateAlertRuleInput,
): Promise<AlertRule> {
  return createAlertRule({
    ...input,
    configuration: input.configuration as Record<string, unknown>,
  });
}

export async function editAlertRule(
  id: string,
  input: UpdateAlertRuleInput,
): Promise<AlertRule | undefined> {
  return updateAlertRule(id, {
    ...input,
    configuration: input.configuration as Record<string, unknown> | undefined,
  });
}
