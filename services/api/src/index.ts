import { resolve } from 'node:path';
import { createApp } from './app';
import { prismaCitizenStore } from './citizens/store';
import { rateLimitsFromEnv } from './config/rate-limits';
import { photoStorageFromEnv } from './config/storage';
import { createPrismaClient } from './db/client';
import { createDbReadiness, localMigrationNames } from './http/health';
import { createPgRateLimitStore } from './http/rate-limit';
import { requestLogger } from './lib/log';

const port = Number(process.env.API_PORT ?? 4000);
// Loopback by default; devices reach it via `adb reverse` (D-18). Containers set API_HOST=0.0.0.0.
const host = process.env.API_HOST ?? '127.0.0.1';
const prisma = createPrismaClient();
const migrations = localMigrationNames(resolve(__dirname, '..', 'prisma', 'migrations'));
const photoStorage = photoStorageFromEnv(process.env, resolve(__dirname, '..', '..', '..'));

createApp({
  production: process.env.NODE_ENV === 'production',
  db: createDbReadiness(prisma, migrations),
  citizens: { store: prismaCitizenStore(prisma), rateLimitStore: createPgRateLimitStore(prisma), limits: rateLimitsFromEnv() },
  photos: photoStorage
    ? { store: photoStorage.store, claims: photoStorage.claims, local: photoStorage.store, maxBytes: photoStorage.store.maxBytes }
    : undefined,
}).listen(port, host, () => {
  requestLogger('startup').info('api listening', { host, port });
});
