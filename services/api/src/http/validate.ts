// Request body validation with zod schemas (I-05). Failures use the spec §7 error shape.
import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { HttpError } from './errors';

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }));
      next(new HttpError(400, 'validation_failed', 'Request body is invalid', details));
      return;
    }
    res.locals.body = result.data;
    next();
  };
}
