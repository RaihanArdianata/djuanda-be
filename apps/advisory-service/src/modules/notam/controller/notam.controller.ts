import ApiError from "@repo/shared/api-error";
import { success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import { getNotamHistories } from "../service/notam.service";

export const list = catchAsync(async (c) => {
  const data = await getNotamHistories();

  if (!data) {
    throw new ApiError("NOT_FOUND", {
      message: "NOTAM histories not found",
    });
  }

  return success(c, data, {
    message: "Successfully retrieved NOTAM histories",
  });
});
