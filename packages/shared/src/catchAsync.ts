import { logger } from "@repo/logger";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import ApiError from "./apiError";
import { failure, failureFromCode } from "./apiResponse";

export const catchAsync =
  <T>(fn: (c: Context, next: Next) => T) =>
  async (
    c: Context,
    next: Next,
  ): Promise<T extends Promise<infer U> ? U : T> => {
    try {
      const result = (await fn(c, next)) as T;
      return result as T extends Promise<infer U> ? U : T;
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        return failure(c, error.statusCode, {
          code: error.code,
          message: error.message,
          fields: error.fields,
          details: error.details,
        }) as T extends Promise<infer U> ? U : T;
      } else if (error instanceof HTTPException) {
        if (error.status === 401) {
          return failureFromCode(c, "UNAUTHORIZED", {
            message: error.message,
            statusCode: 401,
          }) as T extends Promise<infer U> ? U : T;
        }

        return failureFromCode(c, "HTTP_EXCEPTION", {
          message: error.message,
          statusCode: error.status,
        }) as T extends Promise<infer U> ? U : T;
      }

      let message = "Internal Server Error";
      if (error instanceof Error) {
        message = error?.message;
        logger.error(
          { code: "INTERNAL_ERROR", statusCode: 500, err: error },
          message,
        );
      }

      return failureFromCode(c, "INTERNAL_ERROR", {
        message,
      }) as T extends Promise<infer U> ? U : T;
    }
  };
