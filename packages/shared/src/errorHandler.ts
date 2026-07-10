import { logger } from "@repo/logger";
import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { HTTPResponseError } from "hono/types";
import { failureFromCode } from "./apiResponse";

export const errorHandler: ErrorHandler = (
  error: Error | HTTPResponseError,
  c: Context,
) => {
  if (error instanceof HTTPException) {
    logger.error(
      { code: "HTTP_EXCEPTION", statusCode: error.status },
      error.message || "Request Error",
    );

    return failureFromCode(c, "HTTP_EXCEPTION", {
      message: error.message,
      statusCode: error.status,
    });
  }

  logger.error(
    { code: "INTERNAL_ERROR", statusCode: 500, err: error },
    error.message || "Server Error",
  );

  return failureFromCode(c, "INTERNAL_ERROR", { message: error.message });
};
