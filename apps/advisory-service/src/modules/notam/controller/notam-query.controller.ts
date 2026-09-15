import ApiError from "@repo/shared/api-error";
import { success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import { getNotamMessages } from "../service/notam-query.service";
import { listNotamQuerySchema } from "../validator/notam.validator";

export const list = catchAsync(async (c) => {
  const parsed = listNotamQuerySchema.safeParse(c.req.query());

  if (!parsed.success) {
    throw new ApiError("BAD_REQUEST", {
      message: parsed.error.issues.map((issue) => issue.message).join(", "),
    });
  }

  const result = await getNotamMessages(parsed.data);

  return success(
    c,
    result.items,
    { message: "Successfully retrieved NOTAM list" },
    {
      page: result.page,
      size: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    },
  );
});
