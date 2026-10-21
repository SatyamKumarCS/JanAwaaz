// Request IDs and one access-log line per request (I-05, NFR-OBS).
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { requestLogger } from '../lib/log';

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Reuses a well-formed incoming X-Request-Id (e.g. from the platform proxy), otherwise makes one. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

/** Logs method, path (never the query string, which may carry tokens), status and duration. */
export const accessLog: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    requestLogger(String(res.locals.requestId)).info('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(ms),
    });
  });
  next();
};
