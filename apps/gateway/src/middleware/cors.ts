import { createCorsMiddleware } from "@repo/shared/cors";
import { env } from "../config/env";

export const corsMiddleware = createCorsMiddleware({
  origin: env.CORS_ORIGIN,
});
