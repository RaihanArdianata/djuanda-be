import { passwordSchema } from "@repo/shared/utils/formatter";
import { z } from "zod";

export const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export type loginSchemaType = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().min(1),
  name: z.string().min(1),
  username: z.string().min(1),
  password: passwordSchema,
  phone: z.string().min(1),
});

export type registerSchemaType = z.infer<typeof registerSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required."),
});

export type refreshTokenSchemaType = z.infer<typeof refreshTokenSchema>;
