import { resolve } from 'node:path';
import { createApp } from './app';
import { createPrismaClient } from './db/client';
import { createDbReadiness, localMigrationNames } from './http/health';
import { requestLogger } from './lib/log';

const port = Number(process.env.API_PORT ?? 4000);
// Loopback by default; devices reach it via `adb reverse` (D-18). Containers set API_HOST=0.0.0.0.
const host = process.env.API_HOST ?? '127.0.0.1';
const prisma = createPrismaClient();
const migrations = localMigrationNames(resolve(__dirname, '..', 'prisma', 'migrations'));

createApp({
  production: process.env.NODE_ENV === 'production',
  db: createDbReadiness(prisma, migrations),
}).listen(port, host, () => {
  requestLogger('startup').info('api listening', { host, port });
});
