import { Context, Next } from 'hono';
import { z, ZodError, ZodType } from 'zod';
import { failureFromCode } from '@repo/shared';

const parseRequestBody = async (c: Context) => {
  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return c.req.json();
  }

  if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    return c.req.parseBody();
  }

  return c.req.json();
};

export const validate = (schema: ZodType) => {
  return async (c: Context, next: Next) => {
    try {
      const body = await parseRequestBody(c);
      const parsedData = schema.parse(body);
      c.set('parsedData', parsedData);
      await next();
    } catch (error) {
      if (error instanceof SyntaxError) {
        return failureFromCode(c, 'INVALID_JSON');
      } else if (error instanceof ZodError) {
        const { fieldErrors } = z.flattenError(error);

        return failureFromCode(c, 'VALIDATION_ERROR', { fields: fieldErrors });
      } else {
        return failureFromCode(c, 'INTERNAL_ERROR');
      }
    }
  };
};
