export const redisConfig: { host: string; port: number } = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
};

export const loginRateLimitConfig: Record<
  "maxAttempts" | "windowSeconds",
  number
> = {
  maxAttempts: parseInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || "5", 10),
  windowSeconds: parseInt(
    process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS || "900",
    10,
  ), // 15 menit
};

export const emailConfig: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
} = {
  host: process.env.EMAIL_HOST || "smtp.example.com",
  port: parseInt(process.env.EMAIL_PORT || "587", 10),
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER || "your-email@example.com",
    pass: process.env.EMAIL_PASS || "your-email-password",
  },
};
