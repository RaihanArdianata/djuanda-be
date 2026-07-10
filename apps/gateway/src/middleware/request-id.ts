import { createMiddleware } from "hono/factory";
import { REQUEST_ID_HEADER } from "../config/constants";
import type { Variables } from "../types/hono";
import { generateTraceId } from "../utils/trace";

export const requestId = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const id = incoming || generateTraceId();

    c.set("requestId", id);
    c.header(REQUEST_ID_HEADER, id);

    await next();
  },
);
