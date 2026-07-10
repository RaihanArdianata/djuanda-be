import type { Context, NotFoundHandler } from "hono";
import { failureFromCode } from "../lib/response";

export const notFound: NotFoundHandler = (c: Context) =>
  failureFromCode(c, "NOT_FOUND");
