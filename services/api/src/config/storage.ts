// Photo storage configuration (I-12a; D-09, D-19). STORAGE_DRIVER=local selects the dev driver; unset means
// photo storage is not configured (its routes are not mounted). Other drivers are not implemented yet.
import { PHOTO_MAX_BYTES } from '@janawaaz/shared';
import { LocalPhotoStore } from '../storage/local-photo-store';
import { UploadClaims } from '../storage/upload-claim';

/** FR-1.2 "<500 KB": the shared contract with the app's compression loop (packages/shared). */
export const DEFAULT_PHOTO_MAX_BYTES = PHOTO_MAX_BYTES;
export const DEFAULT_UPLOAD_TTL_SECONDS = 600;
/** Signed reads: 15 minutes, as for the office link page (D-11 Q4). */
export const DEFAULT_READ_TTL_SECONDS = 900;
/** Upload claims must outlive the upload and cover offline-outbox retries of the create call (provisional). */
export const DEFAULT_CLAIM_TTL_SECONDS = 86_400;

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return Number(raw);
}

export interface PhotoStorage {
  store: LocalPhotoStore;
  claims: UploadClaims;
}

export function photoStorageFromEnv(env: NodeJS.ProcessEnv, repoRoot: string): PhotoStorage | null {
  const driver = env.STORAGE_DRIVER ?? '';
  if (driver === '') return null;
  if (driver !== 'local') throw new Error(`STORAGE_DRIVER "${driver}" is not implemented (only "local" for development)`);
  const root = env.PHOTO_STORAGE_DIR;
  const secret = env.STORAGE_SIGNING_SECRET;
  if (!root) throw new Error('PHOTO_STORAGE_DIR is required when STORAGE_DRIVER=local');
  if (!secret) throw new Error('STORAGE_SIGNING_SECRET is required when STORAGE_DRIVER=local');
  const claimSecret = env.UPLOAD_CLAIM_SECRET;
  if (!claimSecret) throw new Error('UPLOAD_CLAIM_SECRET is required when photo storage is enabled');
  if (claimSecret === secret) throw new Error('UPLOAD_CLAIM_SECRET must differ from STORAGE_SIGNING_SECRET');
  const maxBytes = positiveInt(env, 'PHOTO_MAX_BYTES', DEFAULT_PHOTO_MAX_BYTES);
  if (maxBytes > PHOTO_MAX_BYTES) throw new Error(`PHOTO_MAX_BYTES cannot exceed the shared contract (${PHOTO_MAX_BYTES})`);
  const store = new LocalPhotoStore({
    root,
    secret,
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL || undefined,
    uploadTtlSeconds: positiveInt(env, 'PHOTO_UPLOAD_TTL_SECONDS', DEFAULT_UPLOAD_TTL_SECONDS),
    readTtlSeconds: positiveInt(env, 'PHOTO_READ_TTL_SECONDS', DEFAULT_READ_TTL_SECONDS),
    maxBytes,
    nodeEnv: env.NODE_ENV,
    forbiddenRoot: repoRoot,
  });
  return { store, claims: new UploadClaims(claimSecret, positiveInt(env, 'UPLOAD_CLAIM_TTL_SECONDS', DEFAULT_CLAIM_TTL_SECONDS)) };
}
