// Upload signing and the dev storage endpoints (I-12a).
// - POST /uploads/sign (citizen bearer token, spec §7): returns an opaque key, a signed expiring PUT URL and a
//   citizen-bound claim that complaint creation (I-13) must verify. Rate-limited per credential; the credential
//   is checked first, so malformed or missing tokens never count. Blocked citizens may sign (decision 3);
//   I-13 refuses their submissions.
// - PUT  /dev-storage/upload/:key?exp&max&sig: the signed URL itself is the authorisation (no citizen token),
//   like a cloud pre-signed URL; content is checked by magic bytes, size-limited and never overwrites.
// - GET  /dev-storage/read/:key?exp&sig: signed, expiring, private read.
// Signatures live in the query string, which the access log never records (http/request-context.ts).
import express, { type RequestHandler, Router } from 'express';
import { requireCitizen } from '../citizens/auth';
import type { CitizenRecord, CitizenStore } from '../citizens/store';
import type { RateLimits } from '../config/rate-limits';
import { HttpError } from '../http/errors';
import { type RateLimitStore, rateLimit } from '../http/rate-limit';
import { type LocalPhotoStore, SignatureError } from './local-photo-store';
import { type PhotoStore, sniffImageType, StorageUnavailableError } from './photo-store';
import type { UploadClaims } from './upload-claim';

const FORBIDDEN = () => new HttpError(403, 'invalid_signature', 'The storage link is invalid or has expired');

function mapStorageErrors(err: unknown): unknown {
  if (err instanceof SignatureError) return FORBIDDEN();
  if (err instanceof StorageUnavailableError) return new HttpError(503, 'storage_unavailable', 'Photo storage is unavailable; try again later');
  return err;
}

export interface UploadSignDeps {
  photos: PhotoStore;
  claims: UploadClaims;
  citizens: CitizenStore;
  rateLimitStore: RateLimitStore;
  limits: RateLimits;
  now?: () => number;
}

export function uploadSignRouter(deps: UploadSignDeps): Router {
  const router = Router();
  router.post(
    '/uploads/sign',
    requireCitizen({ store: deps.citizens, now: deps.now }),
    rateLimit({
      scope: 'upload_sign_credential_minute',
      limit: deps.limits.uploadSignPerCredentialMinute,
      windowSeconds: 60,
      store: deps.rateLimitStore,
      now: deps.now,
      key: (_req, res) => `citizen:${(res.locals.citizen as CitizenRecord).id}`,
    }),
    async (_req, res, next) => {
      try {
        const citizen = res.locals.citizen as CitizenRecord;
        const t = await deps.photos.createUploadTarget();
        const claim = deps.claims.issue(t.key, citizen.id);
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json({
          key: t.key,
          claim: claim.claim,
          claim_expires_at: claim.expires_at,
          upload: { method: t.method, url: t.url, expires_at: t.expires_at, max_bytes: t.max_bytes, accepted_types: t.accepted_types },
        });
      } catch (err) {
        next(mapStorageErrors(err));
      }
    },
  );
  return router;
}

/** Mounted before the app's JSON parser so image bodies are read raw. */
export function devStorageRouter(store: LocalPhotoStore, maxBytes: number): Router {
  const router = Router();
  const verify =
    (op: 'upload' | 'read'): RequestHandler =>
    (req, res, next) => {
      try {
        res.locals.verified = store.verify(op, String(req.params.key), req.query as Record<string, unknown>);
        next();
      } catch (err) {
        next(mapStorageErrors(err));
      }
    };

  router.put(
    '/dev-storage/upload/:key',
    verify('upload'),
    // Any client Content-Type is accepted and ignored; the bytes decide (sniffImageType).
    express.raw({ type: () => true, limit: maxBytes }),
    async (req, res, next) => {
      try {
        const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (body.length > res.locals.verified.maxBytes) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
        const type = sniffImageType(body);
        if (!type) throw new HttpError(415, 'invalid_image', 'Only JPEG, PNG or WebP photos are accepted');
        const result = await store.put(res.locals.verified.key, body);
        if (result === 'exists') throw new HttpError(409, 'already_uploaded', 'This upload link has already been used');
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json({ key: res.locals.verified.key, content_type: type, bytes: body.length });
      } catch (err) {
        next(mapStorageErrors(err));
      }
    },
  );

  router.get('/dev-storage/read/:key', verify('read'), async (_req, res, next) => {
    try {
      const body = await store.get(res.locals.verified.key);
      if (!body) throw new HttpError(404, 'not_found', 'Photo not found');
      const type = sniffImageType(body);
      if (!type) throw new HttpError(404, 'not_found', 'Photo not found');
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', 'inline');
      res.status(200).end(body);
    } catch (err) {
      next(mapStorageErrors(err));
    }
  });
  return router;
}
