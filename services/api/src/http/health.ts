// Liveness and readiness (I-05). /health/ready is what the Compose health check uses (I-41):
// 200 only when the database is reachable and every committed migration is applied. The AI
// service is reported but never required.
import { readdirSync } from 'node:fs';
import { Router } from 'express';

export interface ReadinessResult {
  ok: boolean;
  reason?: string;
}

export type DbReadiness = () => Promise<ReadinessResult>;
export type AiStatus = () => Promise<'up' | 'down' | 'not_configured'>;
export type StorageStatus = () => Promise<'ok' | 'degraded'>;

interface RawQuery {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/** Migration folder names under prisma/migrations (each is one committed migration). */
export function localMigrationNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function createDbReadiness(db: RawQuery, expectedMigrations: string[]): DbReadiness {
  return async () => {
    try {
      const rows = await db.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      const applied = new Set(rows.map((r) => r.migration_name));
      const missing = expectedMigrations.filter((m) => !applied.has(m));
      return missing.length ? { ok: false, reason: 'migrations_pending' } : { ok: true };
    } catch {
      // Never echo the driver error: it can contain host names or connection details.
      return { ok: false, reason: 'database_unreachable' };
    }
  };
}

export function healthRouter(deps: { db?: DbReadiness; ai?: AiStatus; storage?: StorageStatus }) {
  const router = Router();
  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  router.get('/health/ready', async (_req, res) => {
    const db: ReadinessResult = deps.db ? await deps.db() : { ok: false, reason: 'not_configured' };
    const ai = deps.ai ? await deps.ai().catch(() => 'down' as const) : 'not_configured';
    // Storage is reported but never makes the API unready (I-12: paused/unreachable storage is non-fatal).
    const storage = deps.storage ? await deps.storage().catch(() => 'degraded' as const) : 'not_configured';
    res.status(db.ok ? 200 : 503).json({
      status: db.ok ? 'ready' : 'not_ready',
      checks: { database: db.ok ? 'ok' : db.reason, ai, storage },
    });
  });
  return router;
}
