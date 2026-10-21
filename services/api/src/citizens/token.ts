// Anonymous citizen credentials (D-02 Q1): a 256-bit CSPRNG bearer token; only its SHA-256 hash is
// stored (enough for a random 256-bit secret, and it allows lookup by hash).
import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes as base64url without padding: always 43 characters. */
export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function newCitizenToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashCitizenToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
