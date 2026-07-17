import { userStatusEnum } from "@repo/database";
import { passwordSchema } from "@repo/shared";
import z from "zod";

const statusEnum = userStatusEnum.enumValues.map((status) => z.literal(status));

export const getAllUsersSchema = z.object({
  page: z.string().min(1).optional().default("1"),
  size: z.string().min(1).max(100).optional().default("10"),
  search: z.string().optional(),
  role: z.string().optional(),
  status: z.union(statusEnum).optional(),
  id: z.uuid().optional(),
});

export type GetAllUsersParams = z.infer<typeof getAllUsersSchema>;

export const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  username: z.string().min(1).max(255),
  email: z.email().min(1).max(255),
  phone: z.string().min(1).max(20),
  password: passwordSchema,
  role: z.number().int(),
});

export type CreateUserParams = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.email().min(1).max(255).optional(),
  phone: z.string().min(1).max(20).optional(),
  role: z.number().int().optional(),
  status: z.union(statusEnum).optional(),
});

export type UpdateUserParams = z.infer<typeof updateUserSchema>;

export const updateUserPasswordSchema = createUserSchema.pick({
  password: true,
});

export type UpdateUserPasswordParams = z.infer<typeof updateUserPasswordSchema>;
