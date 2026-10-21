// Photo storage interface (I-12; D-09, D-19). Photos are private: they are written and read only through
// short-lived signed URLs, and the API never exposes where or how they are stored. Dev uses the local-disk
// driver (local-photo-store.ts); staging/production will use a Supabase driver behind the same interface.

export interface SignedTarget {
  url: string;
  expires_at: string;
}

export interface UploadTarget extends SignedTarget {
  /** Opaque object key, later stored on the complaint (`complaints.image_url`). */
  key: string;
  method: 'PUT';
  max_bytes: number;
  accepted_types: readonly string[];
}

export interface PhotoStore {
  createUploadTarget(): Promise<UploadTarget>;
  createReadUrl(key: string): Promise<SignedTarget>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
  /** Reachability for /health/ready; never throws. */
  health(): Promise<'ok' | 'degraded'>;
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

/** Server-generated object keys: a random UUID, nothing else (no directories, no client input). */
export const KEY_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Image types accepted, recognised by content, never by the client's Content-Type or filename.
 * The app re-encodes to JPEG (spec §8); PNG and WebP are accepted for gallery fallbacks.
 */
export function sniffImageType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9) {
    return 'image/jpeg';
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.subarray(0, 8).equals(png) && buf.subarray(buf.length - 8, buf.length - 4).toString('latin1') === 'IEND') return 'image/png';
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP' &&
    buf.readUInt32LE(4) + 8 === buf.length
  ) {
    return 'image/webp';
  }
  return null;
}

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
