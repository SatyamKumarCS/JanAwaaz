// I-07a against the throwaway local test database: real citizens table and PostgreSQL rate limits.
import request from 'supertest';
import { createApp } from '../src/app';
import { requireCitizen } from '../src/citizens/auth';
import { prismaCitizenStore } from '../src/citizens/store';
import { hashCitizenToken } from '../src/citizens/token';
import { createPrismaClient } from '../src/db/client';
import { createPgRateLimitStore } from '../src/http/rate-limit';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { targets } = require('./target.cjs') as { targets: () => { testUrl: string } };

const prisma = createPrismaClient(targets().testUrl);
const deps = {
  store: prismaCitizenStore(prisma),
  rateLimitStore: createPgRateLimitStore(prisma),
  limits: { registerPerIpHour: 3, registerPerIpDay: 30, uploadSignPerCredentialMinute: 120 },
};
const app = createApp({
  citizens: deps,
  routes: (r) => {
    r.get('/whoami', requireCitizen(deps), (_q, res) => {
      res.json({ id: res.locals.citizen.id });
    });
  },
});

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE citizens RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`DELETE FROM rate_limit_counters WHERE scope LIKE 'register_%'`;
});
afterAll(async () => {
  await prisma.$disconnect();
  jest.restoreAllMocks();
});

test('registration stores only the hash; the plaintext is in no column of the row', async () => {
  const res = await request(app).post('/auth/citizen/register').send({ locale: 'en' });
  expect(res.status).toBe(201);
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM citizens`;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.token_hash).toBe(hashCitizenToken(res.body.token));
  expect(rows[0]).toMatchObject({ locale: 'en', integrity_tier: 'unknown', blocked_at: null });
  expect(JSON.stringify(rows[0])).not.toContain(res.body.token);
});

test('the issued token authenticates and sets last_seen_at; a wrong one is 401', async () => {
  const { token } = (await request(app).post('/auth/citizen/register')).body;
  const ok = await request(app).get('/whoami').set('Authorization', `Bearer ${token}`);
  expect(ok.status).toBe(200);
  const [row] = await prisma.$queryRaw<{ id: number; last_seen_at: Date | null }[]>`SELECT id, last_seen_at FROM citizens`;
  expect(ok.body.id).toBe(row!.id);
  expect(row!.last_seen_at).not.toBeNull();
  const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  expect((await request(app).get('/whoami').set('Authorization', `Bearer ${flipped}`)).status).toBe(401);
});

test('the per-IP hourly limit is enforced through rate_limit_counters', async () => {
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await request(app).post('/auth/citizen/register')).status);
  expect(statuses).toEqual([201, 201, 201, 429]);
  const [c] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM citizens`;
  expect(Number(c!.n)).toBe(3);
});

test('citizens are not users, and no contact column exists (DEV-D02)', async () => {
  const cols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'citizens'`;
  const names = cols.map((c) => c.column_name);
  expect(names).toContain('token_hash');
  expect(names.filter((n) => /phone|email|mobile|name/.test(n))).toEqual([]);
  const roles = await prisma.$queryRaw<{ enumlabel: string }[]>`
    SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'user_role' ORDER BY e.enumsortorder`;
  expect(roles.map((r) => r.enumlabel)).toEqual(['staff', 'admin']);
});
