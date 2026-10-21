// Runtime Prisma client (I-02): pooled DATABASE_URL through the pg driver adapter.
// The CLI uses DIRECT_URL via prisma.config.ts. No connection string is hardcoded.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
