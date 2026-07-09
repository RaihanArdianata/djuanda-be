import { decode, sign, verify, jwt } from 'hono/jwt';

interface tokenParams {
  email: string;
  national_id?: string;
  id: string;
  role: string;
}

export const generateToken = async ({ email, id, role }: tokenParams) => {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 1 day expiration

  const payload = {
    id,
    email,
    type: 'access',
    exp,
    iat: Math.floor(Date.now() / 1000),
    role,
  };
  const secret = process.env.JWT_SECRET || 'default';
  const token = await sign(payload, secret, 'HS256');

  return {
    accessToken: token,
    expiresAt: new Date(exp * 1000),
  };
};

export const generateRefreshToken = async ({ email, national_id, id }: tokenParams) => {
  const tmpExp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days expiration
  const payload = {
    id,
    email,
    national_id,
    type: 'refresh',
    exp: tmpExp,
    iat: Math.floor(Date.now() / 1000),
  };
  const secret = process.env.JWT_SECRET || 'default';
  const token = await sign(payload, secret, 'HS256');

  return { token, tmpExp };
};

export const verifyToken = async (token: string) => {
  const secret = process.env.JWT_SECRET || 'default';
  const result = await verify(token, secret, 'HS256');

  return result;
};

export const decodeToken = async (token: string) => {
  const result = await decode(token);

  return result;
};
