// I-12a against the throwaway local test database: the /uploads/sign per-credential limit through the real
// PostgreSQL limiter (rate_limit_counters), including the window reset. Photos go to a temp directory.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { prismaCitizenStore } from '../src/citizens/store';
import { createPrismaClient } from '../src/db/client';
import { createPgRateLimitStore } from '../src/http/rate-limit';
import { LocalPhotoStore } from '../src/storage/local-photo-store';
import { UploadClaims } from '../src/storage/upload-claim';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { targets } = require('./target.cjs') as { targets: () => { testUrl: string } };

const prisma = createPrismaClient(targets().testUrl);
let now = Date.UTC(2026, 9, 21, 12, 0, 10);
let dir: string;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'janawaaz-upload-db-'));
  await prisma.$executeRaw`TRUNCATE citizens RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`DELETE FROM rate_limit_counters WHERE scope IN ('upload_sign_credential_minute', 'register_ip_hour', 'register_ip_day')`;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
afterAll(async () => {
  await prisma.$disconnect();
  jest.restoreAllMocks();
});

function app() {
  const store = new LocalPhotoStore({
    root: join(dir, 'photos'),
    secret: 'test-only-signing-secret-0123456789abcdef',
    uploadTtlSeconds: 600,
    readTtlSeconds: 900,
    maxBytes: 4096,
    nodeEnv: 'test',
    now: () => now,
  });
  return createApp({
    citizens: {
      store: prismaCitizenStore(prisma),
      rateLimitStore: createPgRateLimitStore(prisma),
      limits: { registerPerIpHour: 10, registerPerIpDay: 30, uploadSignPerCredentialMinute: 3 },
      now: () => now,
    },
    photos: { store, claims: new UploadClaims('test-only-claim-secret-fedcba9876543210xyz', 86_400, () => now), local: store, maxBytes: 4096 },
  });
}

test('per-credential sign limit is enforced in PostgreSQL and reopens in the next minute', async () => {
  const a = app();
  const t1 = (await request(a).post('/auth/citizen/register')).body.token;
  const t2 = (await request(a).post('/auth/citizen/register')).body.token;
  const sign = (t: string) => request(a).post('/uploads/sign').set('Authorization', `Bearer ${t}`);
  expect([(await sign(t1)).status, (await sign(t1)).status, (await sign(t1)).status, (await sign(t1)).status]).toEqual([201, 201, 201, 429]);
  expect((await sign(t2)).status).toBe(201);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count FROM rate_limit_counters WHERE scope = 'upload_sign_credential_minute' ORDER BY count DESC`;
  expect(rows.map((r) => r.count)).toEqual([4, 1]);
  now += 50_000; // 12:01:00 — a new window
  expect((await sign(t1)).status).toBe(201);
});

test('missing or unknown credentials are rejected before any counter is written', async () => {
  const a = app();
  expect((await request(a).post('/uploads/sign')).status).toBe(401);
  expect((await request(a).post('/uploads/sign').set('Authorization', `Bearer ${'A'.repeat(43)}`)).status).toBe(401);
  const [c] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM rate_limit_counters WHERE scope = 'upload_sign_credential_minute'`;
  expect(Number(c!.n)).toBe(0);
});
