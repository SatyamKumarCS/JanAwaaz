// Prisma 7 CLI configuration (I-02). The CLI connects through DIRECT_URL (unpooled);
// the runtime client uses DATABASE_URL via @prisma/adapter-pg (src/db/client.ts).
// Environment is supplied by scripts/db.mjs, which loads exactly one env file per target
// (.env for local, .env.neon for Neon) — this file never reads env files itself.
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
});
