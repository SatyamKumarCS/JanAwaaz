// I-07a: anonymous citizen registration, authentication and the owner check (in-memory stores).
import request from 'supertest';
import { createApp } from '../src/app';
import { ensureOwner, requireCitizen } from '../src/citizens/auth';
import type { CitizenRecord, CitizenStore, Locale } from '../src/citizens/store';
import { hashCitizenToken, newCitizenToken, TOKEN_FORMAT } from '../src/citizens/token';
import { DEFAULT_RATE_LIMITS, rateLimitsFromEnv } from '../src/config/rate-limits';
import type { RateLimitStore } from '../src/http/rate-limit';

function memoryCitizens() {
  const rows: (CitizenRecord & { token_hash: string })[] = [];
  const touched: number[] = [];
  const store: CitizenStore = {
    async create(token_hash: string, locale: Locale) {
      const row = { id: rows.length + 1, token_hash, locale, integrity_tier: 'unknown' as const, blocked_at: null, last_seen_at: null };
      rows.push(row);
      return row;
    },
    async findByTokenHash(h) {
      return rows.find((r) => r.token_hash === h) ?? null;
    },
    async touch(id, at) {
      touched.push(id);
      rows.find((r) => r.id === id)!.last_seen_at = at;
    },
  };
  return { store, rows, touched };
}

function memoryRateStore(): RateLimitStore {
  const m = new Map<string, number>();
  return {
    async hit(scope, key, ws) {
      const k = `${scope}|${key}|${ws.toISOString()}`;
      m.set(k, (m.get(k) ?? 0) + 1);
      return m.get(k)!;
    },
  };
}

let output: string[];
beforeEach(() => {
  output = [];
  for (const m of ['log', 'warn', 'error'] as const) {
    jest.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      output.push(a.map(String).join(' '));
    });
  }
});
afterEach(() => jest.restoreAllMocks());

function setup(limits = DEFAULT_RATE_LIMITS, now = () => Date.UTC(2026, 9, 21, 10, 0, 0)) {
  const citizens = memoryCitizens();
  const deps = { store: citizens.store, rateLimitStore: memoryRateStore(), limits, now };
  const app = createApp({
    citizens: deps,
    routes: (r) => {
      r.get('/owner-thing/:owner', requireCitizen(deps), (req, res) => {
        ensureOwner(res.locals.citizen, Number(req.params.owner));
        res.json({ citizen: res.locals.citizen.id, blocked: res.locals.citizen.blocked_at !== null });
      });
    },
  });
  return { app, citizens };
}

describe('POST /auth/citizen/register', () => {
  test('returns a fresh 256-bit token; only its SHA-256 hash is stored; not cacheable', async () => {
    const { app, citizens } = setup();
    const res = await request(app).post('/auth/citizen/register').send({ locale: 'en' });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ token: expect.stringMatching(TOKEN_FORMAT), locale: 'en', integrity_tier: 'unknown' });
    expect(Buffer.from(res.body.token, 'base64url')).toHaveLength(32);
    expect(citizens.rows).toHaveLength(1);
    expect(citizens.rows[0]!.token_hash).toBe(hashCitizenToken(res.body.token));
    expect(JSON.stringify(citizens.rows)).not.toContain(res.body.token);
  });

  test('defaults to Hindi and issues a different token every time', async () => {
    const { app } = setup();
    const a = await request(app).post('/auth/citizen/register').send({});
    const b = await request(app).post('/auth/citizen/register');
    expect(a.body.locale).toBe('hi');
    expect(a.body.token).not.toBe(b.body.token);
  });

  test('accepts no contact data or other fields (DEV-D02)', async () => {
    const { app, citizens } = setup();
    for (const body of [{ phone: '9999999999' }, { email: 'x@example.invalid' }, { name: 'x' }, { locale: 'fr' }]) {
      const res = await request(app).post('/auth/citizen/register').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
    expect(citizens.rows).toHaveLength(0);
  });

  test('11th registration from one IP within the hour → 429 with Retry-After and Hindi message', async () => {
    const { app } = setup();
    for (let i = 0; i < 10; i++) expect((await request(app).post('/auth/citizen/register')).status).toBe(201);
    const res = await request(app).post('/auth/citizen/register');
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.error.details.message_hi).toMatch(/[ऀ-ॿ]/);
  });

  test('the daily per-IP cap applies across hours', async () => {
    let t = Date.UTC(2026, 9, 21, 0, 30, 0);
    const { app } = setup({ ...DEFAULT_RATE_LIMITS, registerPerIpHour: 10, registerPerIpDay: 3 }, () => t);
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post('/auth/citizen/register')).status).toBe(201);
      t += 3600_000;
    }
    expect((await request(app).post('/auth/citizen/register')).status).toBe(429);
  });

  test('the token never appears in any log line', async () => {
    const { app } = setup();
    const { body } = await request(app).post('/auth/citizen/register');
    await request(app).get('/owner-thing/1').set('Authorization', `Bearer ${body.token}`);
    await request(app).get('/owner-thing/2').set('Authorization', `Bearer ${body.token}`);
    expect(output.length).toBeGreaterThan(0);
    expect(output.join('\n')).not.toContain(body.token);
  });
});

describe('requireCitizen and ensureOwner', () => {
  test('401 without a token, with a malformed header, or with an unknown token', async () => {
    const { app } = setup();
    for (const auth of [undefined, 'Bearer', `Basic ${newCitizenToken()}`, 'Bearer short', `Bearer ${newCitizenToken()}`]) {
      const req = request(app).get('/owner-thing/1');
      const res = await (auth ? req.set('Authorization', auth) : req);
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.body.error.code).toBe('unauthorized');
    }
  });

  test('200 for the owner, 403 with another citizen’s valid token', async () => {
    const { app } = setup();
    const a = (await request(app).post('/auth/citizen/register')).body.token;
    const b = (await request(app).post('/auth/citizen/register')).body.token;
    expect((await request(app).get('/owner-thing/1').set('Authorization', `Bearer ${a}`)).status).toBe(200);
    const res = await request(app).get('/owner-thing/1').set('Authorization', `Bearer ${b}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect(res.body.error.details.message_hi).toMatch(/[ऀ-ॿ]/);
  });

  test('blocked credentials still authenticate (owners keep read access; submit refuses later)', async () => {
    const { app, citizens } = setup();
    const t = (await request(app).post('/auth/citizen/register')).body.token;
    citizens.rows[0]!.blocked_at = new Date();
    const res = await request(app).get('/owner-thing/1').set('Authorization', `Bearer ${t}`);
    expect(res.body).toEqual({ citizen: 1, blocked: true });
  });

  test('last_seen_at is refreshed at most hourly', async () => {
    let t = Date.UTC(2026, 9, 21, 10, 0, 0);
    const { app, citizens } = setup(DEFAULT_RATE_LIMITS, () => t);
    const tok = (await request(app).post('/auth/citizen/register')).body.token;
    const hit = () => request(app).get('/owner-thing/1').set('Authorization', `Bearer ${tok}`);
    await hit();
    t += 59 * 60_000;
    await hit();
    t += 2 * 60_000;
    await hit();
    expect(citizens.touched).toEqual([1, 1]);
  });

  test('ensureOwner treats a null owner as someone else', () => {
    const c = { id: 1, locale: 'hi' as const, integrity_tier: 'unknown' as const, blocked_at: null, last_seen_at: null };
    expect(() => ensureOwner(c, null)).toThrow(/someone else/);
  });
});

describe('RATE_LIMITS_* configuration', () => {
  test('defaults from D-02 Q3 and valid overrides', () => {
    expect(rateLimitsFromEnv({})).toEqual({ registerPerIpHour: 10, registerPerIpDay: 30, uploadSignPerCredentialMinute: 120 });
    expect(rateLimitsFromEnv({ RATE_LIMITS_REGISTER_PER_IP_HOUR: '5' }).registerPerIpHour).toBe(5);
  });

  test('a malformed value fails instead of defaulting', () => {
    for (const v of ['0', '-1', 'ten', '1.5']) {
      expect(() => rateLimitsFromEnv({ RATE_LIMITS_REGISTER_PER_IP_DAY: v })).toThrow(/positive integer/);
    }
  });
});
