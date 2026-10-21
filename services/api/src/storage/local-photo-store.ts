// Local-disk PhotoStore for development (D-19): files on the photos_dev volume (or a directory outside the
// repository), served only through HMAC-signed, expiring /dev-storage/* URLs. Refuses production.
//
// Security properties:
// - keys are server-generated UUIDs (KEY_FORMAT), so no client input reaches a filesystem path;
// - the root is resolved with realpath and must lie outside the source tree;
// - writes go to an exclusive temp file and are published with link(), which never overwrites, so a
//   signed upload URL works once and an existing photo can't be replaced through it;
// - reads open with O_NOFOLLOW, so a symlink planted in the root is never followed;
// - signatures cover (operation, key, expiry, size limit) and are compared in constant time.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, promises as fs, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ACCEPTED_TYPES, KEY_FORMAT, type PhotoStore, StorageUnavailableError, type UploadTarget } from './photo-store';

export type Op = 'upload' | 'read';

export interface LocalPhotoStoreOptions {
  root: string;
  secret: string;
  /** Base for the signed URLs; defaults to a path-only URL ("/dev-storage/…"). */
  publicBaseUrl?: string;
  uploadTtlSeconds: number;
  readTtlSeconds: number;
  maxBytes: number;
  nodeEnv?: string;
  /** Directory that uploads must never be written into (the repository). */
  forbiddenRoot?: string;
  now?: () => number;
}

export interface VerifiedRequest {
  key: string;
  maxBytes: number;
}

export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureError';
  }
}

export class LocalPhotoStore implements PhotoStore {
  readonly root: string;
  private readonly secret: Buffer;
  private readonly now: () => number;

  constructor(private readonly opts: LocalPhotoStoreOptions) {
    if ((opts.nodeEnv ?? process.env.NODE_ENV) === 'production') {
      throw new Error('the local PhotoStore is for development only and refuses to start in production (D-19)');
    }
    if (Buffer.byteLength(opts.secret, 'utf8') < 32) throw new Error('STORAGE_SIGNING_SECRET must be at least 32 bytes');
    if (!isAbsolute(opts.root)) throw new Error('PHOTO_STORAGE_DIR must be an absolute path');
    const forbidden = opts.forbiddenRoot ? realpathSync(opts.forbiddenRoot) : null;
    const inside = (p: string) => {
      if (!forbidden) return false;
      const rel = relative(forbidden, p);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    };
    const refuse = 'PHOTO_STORAGE_DIR must be outside the repository (uploads never go into tracked directories)';
    // Check before creating anything, then again on the real path (a symlinked root can't sneak in).
    if (inside(resolve(opts.root))) throw new Error(refuse);
    mkdirSync(opts.root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(opts.root);
    if (inside(this.root)) throw new Error(refuse);
    for (const n of ['uploadTtlSeconds', 'readTtlSeconds', 'maxBytes'] as const) {
      if (!Number.isInteger(opts[n]) || opts[n] <= 0) throw new Error(`${n} must be a positive integer`);
    }
    this.secret = Buffer.from(opts.secret, 'utf8');
    this.now = opts.now ?? Date.now;
  }

  private mac(op: Op, key: string, exp: number, max: number): Buffer {
    return createHmac('sha256', this.secret).update(`v1\n${op}\n${key}\n${exp}\n${max}`).digest();
  }

  private sign(op: Op, key: string, ttl: number): { url: string; expires_at: string } {
    const exp = Math.floor(this.now() / 1000) + ttl;
    const max = op === 'upload' ? this.opts.maxBytes : 0;
    const sig = this.mac(op, key, exp, max).toString('base64url');
    const q = new URLSearchParams({ exp: String(exp), ...(op === 'upload' ? { max: String(max) } : {}), sig });
    return { url: `${this.opts.publicBaseUrl ?? ''}/dev-storage/${op}/${key}?${q}`, expires_at: new Date(exp * 1000).toISOString() };
  }

  /** Checks key format, expiry and signature. Throws SignatureError (→ 403) on any failure. */
  verify(op: Op, key: string, q: Record<string, unknown>): VerifiedRequest {
    if (!KEY_FORMAT.test(key)) throw new SignatureError('invalid key');
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const exp = str(q.exp);
    const max = op === 'upload' ? str(q.max) : '0';
    const sig = str(q.sig);
    if (!/^\d{1,12}$/.test(exp) || !/^\d{1,12}$/.test(max) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) throw new SignatureError('malformed signature');
    const expected = this.mac(op, key, Number(exp), Number(max));
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new SignatureError('bad signature');
    if (Number(exp) * 1000 <= this.now()) throw new SignatureError('expired');
    return { key, maxBytes: Number(max) };
  }

  private path(key: string): string {
    if (!KEY_FORMAT.test(key)) throw new SignatureError('invalid key');
    const p = join(this.root, key);
    // Defence in depth: the joined path must stay directly inside the root.
    if (resolve(p) !== join(this.root, key) || relative(this.root, p) !== key) throw new SignatureError('invalid key');
    return p;
  }

  get maxBytes(): number {
    return this.opts.maxBytes;
  }

  async createUploadTarget(): Promise<UploadTarget> {
    const key = randomUUID();
    return { key, method: 'PUT', max_bytes: this.opts.maxBytes, accepted_types: ACCEPTED_TYPES, ...this.sign('upload', key, this.opts.uploadTtlSeconds) };
  }

  async createReadUrl(key: string) {
    this.path(key);
    return this.sign('read', key, this.opts.readTtlSeconds);
  }

  /**
   * Stores a verified upload. Returns 'stored', or 'exists' if the key already holds an object.
   * Throws StorageUnavailableError on filesystem failure (no partial object is left behind).
   */
  async put(key: string, body: Buffer): Promise<'stored' | 'exists'> {
    const final = this.path(key);
    const tmp = join(this.root, `.tmp-${randomBytes(16).toString('hex')}`);
    try {
      await fs.writeFile(tmp, body, { flag: 'wx', mode: 0o600 });
      try {
        await fs.link(tmp, final);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
        throw err;
      }
      return 'stored';
    } catch (err) {
      throw new StorageUnavailableError(`write failed (${(err as NodeJS.ErrnoException).code ?? 'unknown'})`);
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  /** Reads an object without following symlinks. Returns null if it does not exist. */
  async get(key: string): Promise<Buffer | null> {
    const p = this.path(key);
    let fh;
    try {
      fh = await fs.open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      if (code === 'ELOOP') throw new SignatureError('not a regular object');
      throw new StorageUnavailableError(`read failed (${code ?? 'unknown'})`);
    }
    try {
      const st = await fh.stat();
      if (!st.isFile()) throw new SignatureError('not a regular object');
      return await fh.readFile();
    } finally {
      await fh.close();
    }
  }

  async delete(key: string): Promise<void> {
    const p = this.path(key);
    try {
      await fs.unlink(p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new StorageUnavailableError(`delete failed (${(err as NodeJS.ErrnoException).code ?? 'unknown'})`);
    }
  }

  async health(): Promise<'ok' | 'degraded'> {
    try {
      await fs.access(this.root, constants.R_OK | constants.W_OK);
      return 'ok';
    } catch {
      return 'degraded';
    }
  }
}
