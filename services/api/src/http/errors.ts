// Error shape from spec §7: {error: {code, message, details?}} (I-05).
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { requestLogger } from '../lib/log';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'not_found', 'Route not found'));
};

/** Maps any error to the spec §7 shape. Unexpected errors are logged (redacted) and never leaked. */
// Express recognises error handlers by their four parameters, so `_next` must stay.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json(errorBody(err.code, err.message, err.details));
    return;
  }
  // body-parser errors carry `type` and `status`.
  const type = (err as { type?: string }).type;
  if (type === 'entity.parse.failed') {
    res.status(400).json(errorBody('invalid_json', 'Request body is not valid JSON'));
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json(errorBody('payload_too_large', 'Request body is too large'));
    return;
  }
  requestLogger(String(res.locals.requestId ?? 'unknown')).error('unhandled error', {
    method: req.method,
    path: req.path,
    error: err,
  });
  res.status(500).json(errorBody('internal_error', 'Something went wrong'));
};
