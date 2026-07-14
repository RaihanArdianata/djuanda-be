import { validate } from '@repo/validation';
import { Hono } from 'hono';
import { login, logout, refreshToken, register } from '../controller/auth.controller';
import { loginSchema, refreshTokenSchema, registerSchema } from '../validator/auth.validator';

const app = new Hono()
  .post('/login', validate(loginSchema), login)
  .post('/register', validate(registerSchema), register)
  .post('/refresh', validate(refreshTokenSchema), refreshToken)
  .post('/logout', logout);

export default app;
