import express from 'express';
import { ComplaintStatus } from '@janawaaz/shared';

// Scaffold only (I-01): health endpoint. Feature routes arrive in later slices.
export function createApp() {
  const app = express();
  app.get('/health', (_req, res) => {
    // Compile-time use of the shared contract (spec §1.5): statuses come from packages/shared.
    const statuses: readonly ComplaintStatus[] = ComplaintStatus.options;
    res.json({ status: 'ok', service: 'api', statuses: statuses.length });
  });
  return app;
}
