import { checkRateLimit, failureFromCode } from "@repo/shared";
import { createMiddleware } from "hono/factory";
import { env } from "../config/env";
import { getClientIp } from "../utils/ip";

export const rateLimit = createMiddleware(async (c, next) => {
  const ip = getClientIp(c);

  const { allowed } = await checkRateLimit({
    key: `gateway:${ip}`,
    limit: env.RATE_LIMIT_MAX_ATTEMPTS,
    windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
  });

  if (!allowed) {
    return failureFromCode(c, "TOO_MANY_ATTEMPTS");
  }

  await next();
});
