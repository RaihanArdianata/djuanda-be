import { env } from "./env";

export const services: Record<string, string> = {
  AUTH_SERVICE: env.AUTH_SERVICE_URL,
  NOTIFICATION_SERVICE: env.NOTIFICATION_SERVICE_URL,
};
