import { failure, success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import {
  addAlertRule,
  editAlertRule,
  getAlertRuleById,
  getAllAlertRules,
} from "../service/alert.rule.service";
import {
  createAlertRuleSchema,
  listAlertRuleInputSchema,
  updateAlertRuleSchema,
} from "../validator/alert.rule.validator";

export const listAlertRulesController = catchAsync(async (c) => {
  const query = c.req.query();
  const parsed = listAlertRuleInputSchema.parse({
    ...query,
    page: query.page,
    limit: query.limit ?? query.size,
  });

  const result = await getAllAlertRules(parsed);
  return success(
    c,
    result.items,
    { message: "Alert rules fetched successfully" },
    {
      page: parsed.page,
      size: parsed.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / parsed.limit),
    },
  );
});

export const getAlertRuleByIdController = catchAsync(async (c) => {
  const { id } = c.req.param();
  const rule = await getAlertRuleById(id);

  if (!rule) {
    return failure(c, 404, {
      code: "NOT_FOUND",
      message: "Alert rule not found",
    });
  }

  return success(c, rule, { message: "Alert rule fetched successfully" });
});

export const createAlertRuleController = catchAsync(async (c) => {
  const body = await c.req.json();
  const input = createAlertRuleSchema.parse(body);

  const rule = await addAlertRule(input);
  return success(c, rule, {
    code: 201,
    message: "Alert rule created successfully",
  });
});

export const updateAlertRuleController = catchAsync(async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const input = updateAlertRuleSchema.parse(body);

  const rule = await editAlertRule(id, input);

  if (!rule) {
    return failure(c, 404, {
      code: "NOT_FOUND",
      message: "Alert rule not found",
    });
  }

  return success(c, rule, { message: "Alert rule updated successfully" });
});
