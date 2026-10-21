import express, { type Router } from 'express';
import { ComplaintStatus } from '@janawaaz/shared';
import { type CitizenAuthDeps, citizenAuthRouter } from './citizens/auth';
import { errorHandler, notFoundHandler } from './http/errors';
import { type AiStatus, type DbReadiness, healthRouter } from './http/health';
import { accessLog, requestId } from './http/request-context';
import { requireHttps, securityHeaders } from './http/security';
import type { LocalPhotoStore } from './storage/local-photo-store';
import type { PhotoStore } from './storage/photo-store';
import { devStorageRouter, uploadSignRouter } from './storage/routes';
import type { UploadClaims } from './storage/upload-claim';

export interface AppOptions {
  /** Production mode: trust the platform proxy, require HTTPS and send HSTS. */
  production?: boolean;
  db?: DbReadiness;
  ai?: AiStatus;
  /** Citizen registration (I-07); omitted in tests that don't need it. */
  citizens?: CitizenAuthDeps;
  /** Photo storage (I-12): the signing route needs `citizens`; `local` adds the /dev-storage routes. */
  photos?: { store: PhotoStore; claims: UploadClaims; local?: LocalPhotoStore; maxBytes: number };
  /** Mounts feature routes before the 404 handler (later slices; also used by tests). */
  routes?: (router: Router) => void;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  // One trusted hop: the platform's TLS-terminating proxy (Render). Locally nothing is trusted.
  if (opts.production) app.set('trust proxy', 1);

  app.use(requestId);
  app.use(accessLog);
  app.use(securityHeaders({ hsts: Boolean(opts.production) }));
  if (opts.production) app.use(requireHttps);
  // Raw image bodies: mounted before the JSON parser.
  if (opts.photos?.local) app.use(devStorageRouter(opts.photos.local, opts.photos.maxBytes));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    // Compile-time use of the shared contract (spec §1.5): statuses come from packages/shared.
    const statuses: readonly ComplaintStatus[] = ComplaintStatus.options;
    res.json({ status: 'ok', service: 'api', statuses: statuses.length });
  });
  app.use(healthRouter({ db: opts.db, ai: opts.ai, storage: opts.photos ? () => opts.photos!.store.health() : undefined }));
  if (opts.citizens) app.use(citizenAuthRouter(opts.citizens));
  if (opts.citizens && opts.photos) {
    const { store, rateLimitStore, limits, now } = opts.citizens;
    app.use(uploadSignRouter({ photos: opts.photos.store, claims: opts.photos.claims, citizens: store, rateLimitStore, limits, now }));
  }

  if (opts.routes) {
    const router = express.Router();
    opts.routes(router);
    app.use(router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
