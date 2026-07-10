import { decode, sign, verify } from "hono/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";

interface TokenParams {
  email: string;
  national_id?: string;
  id: string;
  role: string;
}

<<<<<<< HEAD
export const generateToken = async ({
  email,
  id,
  roles,
}: TokenParams): Promise<string> => {
  const payload = {
    id,
    email,
    type: "access",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
=======
export const generateToken = async ({ email, id, role }: tokenParams) => {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 1 day expiration

  const payload = {
    id,
    email,
    type: 'access',
    exp,
    iat: Math.floor(Date.now() / 1000),
    role,
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
  };
  const secret = process.env.JWT_SECRET || "default";
  const token = await sign(payload, secret, "HS256");

  return token;
};

<<<<<<< HEAD
export const generateRefreshToken = async ({
  email,
  national_id,
  id,
}: TokenParams): Promise<{ token: string; tmpExp: number }> => {
  const tmpExp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
=======
export const generateRefreshToken = async ({ email, national_id, id }: tokenParams) => {
  const tmpExp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days expiration
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
  const payload = {
    id,
    email,
    national_id,
<<<<<<< HEAD
    type: "refresh",
    exp: tmpExp,
=======
    type: 'refresh',
    exp: tmpExp,
    iat: Math.floor(Date.now() / 1000),
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
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

export const decodeToken = async (token: string): Promise<JWTPayload> => {
  const result = await decode(token);

  return result;
};
