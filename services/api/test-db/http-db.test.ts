// I-05 against the throwaway local test database: readiness and the PostgreSQL rate-limit store.
import { resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { createPrismaClient } from '../src/db/client';
import { createDbReadiness, localMigrationNames } from '../src/http/health';
import { createPgRateLimitStore, rateLimit } from '../src/http/rate-limit';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { targets } = require('./target.cjs') as { targets: () => { testUrl: string } };

const prisma = createPrismaClient(targets().testUrl);
const migrations = localMigrationNames(resolve(__dirname, '..', 'prisma', 'migrations'));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterAll(async () => {
  await prisma.$disconnect();
  jest.restoreAllMocks();
});

test('committed migrations are found on disk', () => {
  expect(migrations.length).toBeGreaterThan(0);
});

test('/health/ready → 200 against the migrated database', async () => {
  const res = await request(createApp({ db: createDbReadiness(prisma, migrations) })).get('/health/ready');
  expect(res.status).toBe(200);
  expect(res.body.checks.database).toBe('ok');
});

test('/health/ready → 503 when a committed migration is not applied', async () => {
  const res = await request(createApp({ db: createDbReadiness(prisma, [...migrations, '29990101000000_future']) })).get(
    '/health/ready',
  );
  expect(res.status).toBe(503);
  expect(res.body.checks.database).toBe('migrations_pending');
});

test('/health/ready → 503 when the database is unreachable, without leaking details', async () => {
  // Same credentials and database, but a local port where nothing listens.
  const url = new URL(targets().testUrl);
  url.port = '1';
  const down = createPrismaClient(url.toString());
  try {
    const res = await request(createApp({ db: createDbReadiness(down, migrations) })).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready', checks: { database: 'database_unreachable', ai: 'not_configured' } });
  } finally {
    await down.$disconnect();
  }
});

test('the PostgreSQL store counts concurrent hits atomically', async () => {
  const store = createPgRateLimitStore(prisma);
  const window = new Date(Date.UTC(2026, 9, 21, 12, 0, 0));
  const counts = await Promise.all(Array.from({ length: 20 }, () => store.hit('i05-atomic', 'k', window)));
  expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
});

test('a limited route returns 429 using the PostgreSQL store', async () => {
  const store = createPgRateLimitStore(prisma);
  const now = () => Date.UTC(2026, 9, 21, 12, 5, 30);
  const app = createApp({
    routes: (r) => {
      r.post('/limited', rateLimit({ scope: 'i05-route', limit: 3, windowSeconds: 60, store, now }), (_q, s) => {
        s.json({ ok: true });
      });
    },
  });
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await request(app).post('/limited')).status);
  expect(statuses).toEqual([200, 200, 200, 429]);
  const rows = await prisma.$queryRaw<{ key: string }[]>`SELECT key FROM rate_limit_counters WHERE scope = 'i05-route'`;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.key).toMatch(/^[0-9a-f]{64}$/);
});
