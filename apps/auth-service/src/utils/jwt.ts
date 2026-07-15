import { decode, sign, verify } from "hono/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";

interface TokenParams {
  email: string;
  national_id?: string;
  id: string;
  role: string;
}

export const generateToken = async ({
  email,
  id,
  role,
}: TokenParams): Promise<string> => {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 1 day expiration

  const payload = {
    id,
    email,
    type: "access",
    exp,
    iat: Math.floor(Date.now() / 1000),
    role,
  };
  const secret = process.env.JWT_SECRET || "default";
  const token = await sign(payload, secret, "HS256");

  return token;
};

export const generateRefreshToken = async ({
  email,
  national_id,
  id,
}: TokenParams): Promise<{ token: string; tmpExp: number }> => {
  const tmpExp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days expiration
  const payload = {
    id,
    email,
    national_id,
    type: "refresh",
    exp: tmpExp,
    iat: Math.floor(Date.now() / 1000),
  };
  const secret = process.env.JWT_SECRET || "default";
  const token = await sign(payload, secret, "HS256");

  return { token, tmpExp };
};

export const verifyToken = async (token: string): Promise<JWTPayload> => {
  const secret = process.env.JWT_SECRET || "default";
  const result = await verify(token, secret, "HS256");

  return result;
};

export const decodeToken = (token: string): JWTPayload => {
  return decode(token);
};
