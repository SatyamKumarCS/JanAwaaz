// I-05 HTTP skeleton: error shape, validation, rate limits, HTTPS, security headers, request IDs.
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { HttpError } from '../src/http/errors';
import { type RateLimitStore, rateLimit } from '../src/http/rate-limit';
import { validateBody } from '../src/http/validate';

/** Test double with the same contract as the PostgreSQL store (increment and return the count). */
function memoryStore(): RateLimitStore & { calls: string[] } {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  return {
    calls,
    async hit(scope, key, windowStart) {
      const k = `${scope}|${key}|${windowStart.toISOString()}`;
      calls.push(k);
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n;
    },
  };
}

let logSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const FAKE_CRED = 'fake-test-only';

describe('error shape and validation', () => {
  const Sample = z.object({ name: z.string().min(1), count: z.number().int() });
  const app = createApp({
    routes: (r) => {
      r.post('/sample', validateBody(Sample), (_req, res) => {
        res.status(201).json({ ok: true, body: res.locals.body });
      });
      r.get('/teapot', () => {
        throw new HttpError(418, 'teapot', 'I am a teapot', { hint: 'x' });
      });
      r.get('/boom', () => {
        // Fake URL assembled at runtime (no literal credential-shaped string is committed).
        throw new Error(`connect failed for ${['postgresql://', 'user', ':', FAKE_CRED, '@db.internal:5432/x'].join('')}`);
      });
    },
  });

  test('invalid body → 400 {error:{code,message,details}}', async () => {
    const res = await request(app).post('/sample').send({ name: '', count: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['count', 'name']);
  });

  test('valid body passes the parsed data on', async () => {
    const res = await request(app).post('/sample').send({ name: 'a', count: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, body: { name: 'a', count: 2 } });
  });

  test('malformed JSON → 400 invalid_json', async () => {
    const res = await request(app).post('/sample').set('Content-Type', 'application/json').send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
  });

  test('HttpError keeps its status, code and details', async () => {
    const res = await request(app).get('/teapot');
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ error: { code: 'teapot', message: 'I am a teapot', details: { hint: 'x' } } });
  });

  test('unknown route → 404 in the same shape', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  test('unexpected error → generic 500; details are logged redacted, never returned', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'internal_error', message: 'Something went wrong' } });
    const logged = errSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('postgresql://[redacted]');
    expect(logged).not.toContain(FAKE_CRED);
  });
});

describe('rate limiting', () => {
  test('exceeding the limit → 429 with Retry-After and a bilingual message', async () => {
    const store = memoryStore();
    const now = () => Date.UTC(2026, 9, 21, 10, 0, 15); // 15 s into a 60 s window
    const app = createApp({
      routes: (r) => {
        r.post('/limited', rateLimit({ scope: 'test', limit: 2, windowSeconds: 60, store, now }), (_req, res) => {
          res.json({ ok: true });
        });
      },
    });
    expect((await request(app).post('/limited')).status).toBe(200);
    expect((await request(app).post('/limited')).status).toBe(200);
    const res = await request(app).post('/limited');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('45');
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.body.error.details.message_hi).toMatch(/[ऀ-ॿ]/);
    expect(res.body.error.details.retry_after_seconds).toBe(45);
  });

  test('keys are hashed before reaching the store', async () => {
    const store = memoryStore();
    const app = createApp({
      routes: (r) => {
        r.get('/l', rateLimit({ scope: 's', limit: 5, windowSeconds: 60, store, key: () => '203.0.113.7' }), (_q, s) => {
          s.end();
        });
      },
    });
    await request(app).get('/l');
    expect(store.calls[0]).toMatch(/^s\|[0-9a-f]{64}\|/);
    expect(store.calls[0]).not.toContain('203.0.113.7');
  });

  test('a new window resets the count', async () => {
    const store = memoryStore();
    let t = Date.UTC(2026, 9, 21, 10, 0, 59);
    const app = createApp({
      routes: (r) => {
        r.get('/l', rateLimit({ scope: 's', limit: 1, windowSeconds: 60, store, now: () => t }), (_q, s) => {
          s.end();
        });
      },
    });
    expect((await request(app).get('/l')).status).toBe(200);
    expect((await request(app).get('/l')).status).toBe(429);
    t += 2000;
    expect((await request(app).get('/l')).status).toBe(200);
  });

  test('a store failure is a 500, not a silent pass', async () => {
    const store: RateLimitStore = { hit: async () => Promise.reject(new Error('db down')) };
    const app = createApp({
      routes: (r) => {
        r.get('/l', rateLimit({ scope: 's', limit: 1, windowSeconds: 60, store }), (_q, s) => {
          s.end();
        });
      },
    });
    expect((await request(app).get('/l')).status).toBe(500);
  });
});

describe('HTTPS and security headers', () => {
  const routes = (r: import('express').Router) => {
    r.get('/thing', (_q, s) => {
      s.json({ ok: true });
    });
  };

  test('production rejects plain HTTP (X-Forwarded-Proto: http)', async () => {
    const app = createApp({ production: true, routes });
    const res = await request(app).get('/thing').set('X-Forwarded-Proto', 'http');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('https_required');
  });

  test('production rejects a request with no forwarded proto', async () => {
    const res = await request(createApp({ production: true, routes })).get('/thing');
    expect(res.status).toBe(400);
  });

  test('production accepts HTTPS via the trusted proxy and sends HSTS', async () => {
    const res = await request(createApp({ production: true, routes })).get('/thing').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(200);
    expect(res.headers['strict-transport-security']).toContain('max-age=');
  });

  test('health checks stay reachable over plain HTTP in production', async () => {
    const res = await request(createApp({ production: true })).get('/health/live');
    expect(res.status).toBe(200);
  });

  test('development serves plain HTTP without HSTS', async () => {
    const res = await request(createApp({ routes })).get('/thing');
    expect(res.status).toBe(200);
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  test('security headers are set and X-Powered-By is removed', async () => {
    const res = await request(createApp({ routes })).get('/thing');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('request IDs', () => {
  test('generates an ID, returns it, and logs it on the access line without the query string', async () => {
    const res = await request(createApp()).get('/health/live?token=abc123');
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const line = JSON.parse(String(logSpy.mock.calls.flat().find((l) => String(l).includes('"request"'))));
    expect(line).toMatchObject({ requestId: id, msg: 'request', method: 'GET', path: '/health/live', status: 200 });
    expect(JSON.stringify(line)).not.toContain('abc123');
  });

  test('reuses a well-formed incoming X-Request-Id and replaces a malformed one', async () => {
    const ok = await request(createApp()).get('/health/live').set('X-Request-Id', 'proxy-req-12345');
    expect(ok.headers['x-request-id']).toBe('proxy-req-12345');
    for (const malformed of ['bad id {}', 'short']) {
      const bad = await request(createApp()).get('/health/live').set('X-Request-Id', malformed);
      expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('health', () => {
  test('/health/live is always 200', async () => {
    expect((await request(createApp()).get('/health/live')).status).toBe(200);
  });

  test('/health/ready → 200 when the database is ready; AI is reported but not required', async () => {
    const res = await request(createApp({ db: async () => ({ ok: true }), ai: async () => 'down' })).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', checks: { database: 'ok', ai: 'down', storage: 'not_configured' } });
  });

  test('/health/ready → 503 when the database is unreachable', async () => {
    const res = await request(createApp({ db: async () => ({ ok: false, reason: 'database_unreachable' }) })).get(
      '/health/ready',
    );
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe('database_unreachable');
  });

  test('/health/ready → 503 when no database check is configured', async () => {
    expect((await request(createApp()).get('/health/ready')).status).toBe(503);
  });
});
