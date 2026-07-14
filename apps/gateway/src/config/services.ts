import { env } from './env';

export const services: Record<string, string> = {
  AUTH_SERVICE: env.AUTH_SERVICE_URL,
  NOTIFICATION_SERVICE: env.NOTIFICATION_SERVICE_URL,
  WS_SERVICE: env.WS_SERVICE_URL,
  SSE_SERVICE: env.SSE_SERVICE_URL,
};
