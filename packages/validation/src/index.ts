import { Context, Next } from 'hono';
import { z, ZodError, ZodType } from 'zod';
import { failureFromCode } from '@repo/shared';

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

export const parseRequestBody = (c: Context): Promise<any> => {
  const contentType = c.req.header('Content-Type') || '';

  if (contentType.includes('application/json')) {
    return c.req.json();
  }

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    return c.req.parseBody();
  }

  return c.req.json();
};
