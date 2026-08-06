import { ApiError, catchAsync, success } from "@repo/shared";
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
