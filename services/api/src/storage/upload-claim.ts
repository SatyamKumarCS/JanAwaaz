// Citizen-bound upload claims (I-12a decision 1). `POST /uploads/sign` returns, with each upload key, a
// claim: an HMAC over (key, citizen id, expiry) with a secret separate from any storage driver's. Complaint
// creation (I-13) must call verify() with the submitting citizen before attaching the photo, so an
// unguessable key on its own is never proof of ownership.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { KEY_FORMAT } from './photo-store';

export class ClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaimError';
  }
}

const CLAIM = /^uc1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

export class UploadClaims {
  private readonly secret: Buffer;
  private readonly now: () => number;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
    now?: () => number,
  ) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('UPLOAD_CLAIM_SECRET must be at least 32 bytes');
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error('upload claim TTL must be a positive integer');
    this.secret = Buffer.from(secret, 'utf8');
    this.now = now ?? Date.now;
  }

  private mac(key: string, citizenId: number, exp: number): Buffer {
    return createHmac('sha256', this.secret).update(`upload-claim\nv1\n${key}\n${citizenId}\n${exp}`).digest();
  }

  issue(key: string, citizenId: number): { claim: string; expires_at: string } {
    if (!KEY_FORMAT.test(key)) throw new ClaimError('invalid key');
    if (!Number.isSafeInteger(citizenId) || citizenId <= 0) throw new ClaimError('invalid citizen');
    const exp = Math.floor(this.now() / 1000) + this.ttlSeconds;
    return { claim: `uc1.${exp}.${this.mac(key, citizenId, exp).toString('base64url')}`, expires_at: new Date(exp * 1000).toISOString() };
  }

  /** Throws ClaimError unless `claim` was issued for exactly this key and citizen and has not expired. */
  verify(claim: unknown, key: string, citizenId: number): void {
    const m = typeof claim === 'string' ? CLAIM.exec(claim) : null;
    if (!m || !KEY_FORMAT.test(key) || !Number.isSafeInteger(citizenId) || citizenId <= 0) throw new ClaimError('malformed claim');
    const exp = Number(m[1]);
    const given = Buffer.from(m[2]!, 'base64url');
    const expected = this.mac(key, citizenId, exp);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ClaimError('claim does not match');
    if (exp * 1000 <= this.now()) throw new ClaimError('claim expired');
  }
}
