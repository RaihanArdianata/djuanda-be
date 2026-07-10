import { decode } from "hono/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";

export const decodeToken = async (
  token: string,
): Promise<JWTPayload | null> => {
  try {
    return await decode(token);
  } catch {
    return null;
  }
};
