import { catchAsync, success } from "@repo/shared";
import { getMovements } from "../service/movement.service";
import type { GetMovementsParams } from "../validator/movement.validator";

export const getMovementsController = catchAsync(async (c) => {
  const params = c.get("parsedData") as GetMovementsParams;
  const movements = await getMovements(params);
  return success(c, movements, {
    message: "Aircraft movements retrieved successfully",
  });
});
