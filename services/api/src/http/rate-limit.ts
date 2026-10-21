// Fixed-window rate limits backed by PostgreSQL `rate_limit_counters` (D-02 Q3, spec §7): one atomic
// upsert per request, no Redis and no in-memory-only counters. Keys are hashed before storage.
import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { HttpError } from './errors';

export interface RateLimitStore {
  /** Atomically increments the counter for (scope, key, windowStart) and returns the new count. */
  hit(scope: string, key: string, windowStart: Date): Promise<number>;
}

/** Minimal surface of PrismaClient used here, so the store is testable without a generated client. */
interface RawQuery {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export function createPgRateLimitStore(db: RawQuery): RateLimitStore {
  return {
    async hit(scope, key, windowStart) {
      const rows = await db.$queryRaw<{ count: number }[]>`
        INSERT INTO rate_limit_counters (scope, key, window_start, count)
        VALUES (${scope}, ${key}, ${windowStart}, 1)
        ON CONFLICT (scope, key, window_start)
        DO UPDATE SET count = rate_limit_counters.count + 1
        RETURNING count`;
      return Number(rows[0]?.count ?? 0);
    },
  };
}

export function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface RateLimitOptions {
  scope: string;
  limit: number;
  windowSeconds: number;
  store: RateLimitStore;
  /** Defaults to the client IP (resolved through the trusted proxy). */
  key?: (req: Request) => string;
  now?: () => number;
}

const MESSAGE_EN = 'Too many requests. Please try again later.';
const MESSAGE_HI = 'बहुत अधिक अनुरोध। कृपया थोड़ी देर बाद फिर से प्रयास करें।';

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const windowMs = opts.windowSeconds * 1000;
  const now = opts.now ?? Date.now;
  const keyOf = opts.key ?? ((req: Request) => req.ip ?? 'unknown');
  return async (req, res, next) => {
    try {
      const t = now();
      const windowStart = Math.floor(t / windowMs) * windowMs;
      const count = await opts.store.hit(opts.scope, hashKey(keyOf(req)), new Date(windowStart));
      if (count > opts.limit) {
        const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - t) / 1000));
        res.setHeader('Retry-After', String(retryAfter));
        next(new HttpError(429, 'rate_limited', MESSAGE_EN, { message_hi: MESSAGE_HI, retry_after_seconds: retryAfter }));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
