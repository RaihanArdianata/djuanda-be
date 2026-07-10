import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type ErrorCode, resolveError } from "./constants/errors";
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  ErrorContract,
} from "./types/api-response";

export const success = <T>(
  c: Context,
  data: T,
  options?: { code?: ContentfulStatusCode; message?: string },
): Response => {
  const code = options?.code ?? 200;
  const body: ApiSuccessResponse<T> = {
    data,
    error: null,
    meta: {
      code,
      status: "SUCCESS",
      message: options?.message ?? "Success",
    },
  };

  return c.json(body, code);
};

export const failure = (
  c: Context,
  statusCode: ContentfulStatusCode,
  error: ErrorContract,
): Response => {
  const body: ApiErrorResponse = {
    data: null,
    error,
    meta: {
      code: statusCode,
      status: "ERROR",
    },
  };

  return c.json(body, statusCode);
};

export const failureFromCode = (
  c: Context,
  code: ErrorCode,
  overrides?: {
    message?: string;
    statusCode?: ContentfulStatusCode;
    fields?: Record<string, string[]>;
    details?: unknown;
  },
): Response => {
  const resolved = resolveError(code, overrides);

  return failure(c, resolved.statusCode, {
    code: resolved.code,
    message: resolved.message,
    fields: resolved.fields,
    details: resolved.details,
  });
};
