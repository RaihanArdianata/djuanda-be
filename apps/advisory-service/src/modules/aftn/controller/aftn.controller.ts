import { failureFromCode, success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import { getAftnMessageById, getAftnMessages } from "../service/aftn.service";
import type { ListAftnQueryInput } from "../validator/aftn.validator";

export const list = catchAsync(async (c) => {
  const query = c.get("parsedData") as ListAftnQueryInput;
  const result = await getAftnMessages(query);

  return success(
    c,
    result.items,
    { message: "AFTN messages retrieved successfully" },
    {
      page: result.page,
      size: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    },
  );
});

export const detail = catchAsync(async (c) => {
  const id = c.req.param("id");

  if (!id) {
    return failureFromCode(c, "VALIDATION_ERROR", {
      fields: { id: ["id is required"] },
    });
  }

  const message = await getAftnMessageById(id);

  return success(c, message, {
    message: "AFTN message retrieved successfully",
  });
});
