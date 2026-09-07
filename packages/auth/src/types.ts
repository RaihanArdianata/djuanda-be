import type { UserWithPermissionsType } from "@repo/database";

export type GetUserType = UserWithPermissionsType & {
  permissions: string[];
  passwordHash?: string;
};

export type AuthVariables = {
  jwtPayload: { id: string; email?: string; role?: string };
  user: GetUserType;
};
