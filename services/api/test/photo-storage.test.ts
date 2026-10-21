// I-12a: local PhotoStore, signed upload/read URLs and POST /uploads/sign. Temp directories only;
// image bodies are tiny synthetic byte sequences with the right magic bytes (not real photos).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import type { CitizenStore } from '../src/citizens/store';
import { hashCitizenToken, newCitizenToken } from '../src/citizens/token';
import { PHOTO_MAX_BYTES } from '@janawaaz/shared';
import { DEFAULT_RATE_LIMITS } from '../src/config/rate-limits';
import { photoStorageFromEnv } from '../src/config/storage';
import type { RateLimitStore } from '../src/http/rate-limit';
import { LocalPhotoStore } from '../src/storage/local-photo-store';
import { KEY_FORMAT, sniffImageType } from '../src/storage/photo-store';
import { ClaimError, UploadClaims } from '../src/storage/upload-claim';

const SECRET = 'test-only-signing-secret-0123456789abcdef';
const CLAIM_SECRET = 'test-only-claim-secret-fedcba9876543210xyz';
const MAX = 2048;
const T0 = Date.UTC(2026, 9, 21, 12, 0, 0);

const jpeg = (n = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(Math.max(0, n - 6), 0x11), Buffer.from([0xff, 0xd9])]);
const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 0x22), Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'), Buffer.alloc(4, 0xae)]);
const webp = () => {
  const b = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20, 0x33)]);
  b.writeUInt32LE(b.length - 8, 4);
  return b;
};

let base: string;
let root: string;
let outside: string;
let now: number;
let output: string[];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'janawaaz-photos-'));
  root = join(base, 'photos');
  outside = join(base, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside-file-must-never-be-served');
  now = T0;
  output = [];
  for (const m of ['log', 'warn', 'error'] as const) {
    jest.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      output.push(a.map(String).join(' '));
    });
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  if (existsSync(root)) chmodSync(root, 0o700);
  rmSync(base, { recursive: true, force: true });
});

function makeStore(extra: Partial<ConstructorParameters<typeof LocalPhotoStore>[0]> = {}) {
  return new LocalPhotoStore({ root, secret: SECRET, uploadTtlSeconds: 600, readTtlSeconds: 900, maxBytes: MAX, nodeEnv: 'test', now: () => now, ...extra });
}

function memoryRateStore(): RateLimitStore & { keys: string[] } {
  const m = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async hit(scope, key, ws) {
      keys.push(`${scope}|${key}`);
      const k = `${scope}|${key}|${ws.toISOString()}`;
      m.set(k, (m.get(k) ?? 0) + 1);
      return m.get(k)!;
    },
  };
}

function setup(limits = DEFAULT_RATE_LIMITS) {
  const store = makeStore();
  const claims = new UploadClaims(CLAIM_SECRET, 86_400, () => now);
  const token = newCitizenToken();
  const token2 = newCitizenToken();
  const rows = new Map([
    [hashCitizenToken(token), { id: 1, locale: 'hi' as const, integrity_tier: 'unknown' as const, blocked_at: null as Date | null, last_seen_at: new Date(T0) }],
    [hashCitizenToken(token2), { id: 2, locale: 'hi' as const, integrity_tier: 'unknown' as const, blocked_at: null as Date | null, last_seen_at: new Date(T0) }],
  ]);
  const citizens: CitizenStore = {
    create: async () => {
      throw new Error('unused');
    },
    findByTokenHash: async (h) => rows.get(h) ?? null,
    touch: async () => undefined,
  };
  const rateLimitStore = memoryRateStore();
  const app = createApp({
    db: async () => ({ ok: true }),
    citizens: { store: citizens, rateLimitStore, limits, now: () => now },
    photos: { store, claims, local: store, maxBytes: MAX },
  });
  const signAs = (t: string) => request(app).post('/uploads/sign').set('Authorization', `Bearer ${t}`);
  const sign = async () => {
    const res = await signAs(token);
    expect(res.status).toBe(201);
    return res.body as {
      key: string;
      claim: string;
      claim_expires_at: string;
      upload: { url: string; method: string; expires_at: string; max_bytes: number; accepted_types: string[] };
    };
  };
  return { app, store, claims, token, token2, rows, rateLimitStore, sign, signAs };
}

const withParam = (url: string, name: string, value: string) => {
  const u = new URL(url, 'http://x');
  u.searchParams.set(name, value);
  return `${u.pathname}?${u.searchParams}`;
};

describe('POST /uploads/sign', () => {
  test('requires a citizen token', async () => {
    const { app } = setup();
    expect((await request(app).post('/uploads/sign')).status).toBe(401);
  });

  test('returns an opaque key and a signed, expiring PUT URL without any filesystem path', async () => {
    const { sign } = setup();
    const body = await sign();
    expect(body.key).toMatch(KEY_FORMAT);
    expect(body.upload).toEqual({
      method: 'PUT',
      url: expect.stringMatching(new RegExp(`^/dev-storage/upload/${body.key}\\?exp=\\d+&max=${MAX}&sig=[A-Za-z0-9_-]{43}$`)),
      expires_at: new Date(T0 + 600_000).toISOString(),
      max_bytes: MAX,
      accepted_types: ['image/jpeg', 'image/png', 'image/webp'],
    });
    expect(JSON.stringify(body)).not.toContain(base);
    expect(body.claim).toMatch(/^uc1\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(body.claim_expires_at).toBe(new Date(T0 + 86_400_000).toISOString());
  });

  test('blocked citizens may still obtain upload URLs (decision 3; submission is refused in I-13)', async () => {
    const { rows, token, signAs } = setup();
    rows.get(hashCitizenToken(token))!.blocked_at = new Date(T0);
    expect((await signAs(token)).status).toBe(201);
  });
});

describe('citizen-bound upload claims', () => {
  test('a claim verifies only for its own key and citizen', async () => {
    const { claims, sign, signAs, token2 } = setup();
    const a = await sign();
    const b = (await signAs(token2)).body;
    expect(() => claims.verify(a.claim, a.key, 1)).not.toThrow();
    expect(() => claims.verify(a.claim, a.key, 2)).toThrow(ClaimError); // another citizen
    expect(() => claims.verify(a.claim, b.key, 1)).toThrow(ClaimError); // another key
    expect(() => claims.verify(b.claim, a.key, 1)).toThrow(ClaimError); // another citizen's claim
    expect(() => claims.verify(b.claim, b.key, 2)).not.toThrow();
  });

  test('tampered, malformed and expired claims fail', async () => {
    const { claims, sign } = setup();
    const { key, claim } = await sign();
    const [v, exp, mac] = claim.split('.');
    for (const bad of [
      `${v}.${Number(exp) + 3600}.${mac}`,
      `${v}.${exp}.${(mac![0] === 'A' ? 'B' : 'A') + mac!.slice(1)}`,
      `uc2.${exp}.${mac}`,
      claim.slice(0, -1),
      '',
      undefined,
      123,
      key,
    ]) {
      expect(() => claims.verify(bad, key, 1)).toThrow(ClaimError);
    }
    expect(() => claims.verify(claim, '../x', 1)).toThrow(ClaimError);
    expect(() => claims.verify(claim, key, 0)).toThrow(ClaimError);
    now += 86_400_000;
    expect(() => claims.verify(claim, key, 1)).toThrow(/expired/);
  });

  test('the storage signing secret and the claim secret are not interchangeable', async () => {
    const { key, upload } = await setup().sign();
    const urlSig = new URL(upload.url, 'http://x').searchParams.get('sig')!;
    const other = new UploadClaims(SECRET, 86_400, () => now);
    expect(() => new UploadClaims(CLAIM_SECRET, 86_400, () => now).verify(`uc1.${Math.floor(now / 1000) + 60}.${urlSig}`, key, 1)).toThrow(ClaimError);
    expect(() => new UploadClaims(CLAIM_SECRET, 86_400, () => now).verify(other.issue(key, 1).claim, key, 1)).toThrow(ClaimError);
  });
});

describe('POST /uploads/sign rate limit (120/min per credential)', () => {
  test('the 121st request in a minute → 429; the next window is open again', async () => {
    const { signAs, token } = setup();
    for (let i = 0; i < 120; i++) expect((await signAs(token)).status).toBe(201);
    const over = await signAs(token);
    expect(over.status).toBe(429);
    expect(Number(over.headers['retry-after'])).toBe(60);
    now += 60_000;
    expect((await signAs(token)).status).toBe(201);
  });

  test('limits are per credential, counted only after authentication, and keyed by a hash', async () => {
    const { signAs, token, token2, rateLimitStore } = setup({ ...DEFAULT_RATE_LIMITS, uploadSignPerCredentialMinute: 2 });
    expect((await signAs(token)).status).toBe(201);
    expect((await signAs(token)).status).toBe(201);
    expect((await signAs(token)).status).toBe(429);
    expect((await signAs(token2)).status).toBe(201);
    const before = rateLimitStore.keys.length;
    for (const bad of ['Bearer short', `Bearer ${newCitizenToken()}`, '']) {
      const r = bad ? await request(setupApp(rateLimitStore)).post('/uploads/sign').set('Authorization', bad) : await signAs('');
      expect(r.status).toBe(401);
    }
    expect(rateLimitStore.keys.length).toBe(before);
    expect(rateLimitStore.keys.every((k) => /^upload_sign_credential_minute\|[0-9a-f]{64}$/.test(k))).toBe(true);
  });
});

/** A second app sharing one rate-limit store, to show rejected credentials never reach the counter. */
function setupApp(rateLimitStore: RateLimitStore) {
  const store = makeStore();
  return createApp({
    citizens: { store: { create: async () => { throw new Error('unused'); }, findByTokenHash: async () => null, touch: async () => undefined }, rateLimitStore, limits: DEFAULT_RATE_LIMITS, now: () => now },
    photos: { store, claims: new UploadClaims(CLAIM_SECRET, 60, () => now), local: store, maxBytes: MAX },
  });
}

describe('signed upload and read', () => {
  test('valid JPEG/PNG/WebP upload is stored once and readable through a signed URL', async () => {
    const { app, store, sign } = setup();
    for (const [img, type] of [[jpeg(), 'image/jpeg'], [png(), 'image/png'], [webp(), 'image/webp']] as const) {
      const { key, upload } = await sign();
      // The client's Content-Type is ignored: a JPEG sent as text/plain is still a JPEG.
      const put = await request(app).put(upload.url).set('Content-Type', 'text/plain').send(img);
      expect(put.status).toBe(201);
      expect(put.body).toEqual({ key, content_type: type, bytes: img.length });
      expect(readFileSync(join(root, key)).equals(img)).toBe(true);
      const { url } = await store.createReadUrl(key);
      const get = await request(app).get(url).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(get.status).toBe(200);
      expect(get.headers['content-type']).toBe(type);
      expect(get.headers['cache-control']).toBe('private, no-store');
      expect((get.body as Buffer).equals(img)).toBe(true);
    }
  });

  test('an upload URL works once; it can never overwrite the stored photo', async () => {
    const { app, sign, store } = setup();
    const { key, upload } = await sign();
    expect((await request(app).put(upload.url).send(jpeg(64))).status).toBe(201);
    const again = await request(app).put(upload.url).send(jpeg(100));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_uploaded');
    expect(readFileSync(join(root, key))).toHaveLength(64);
    expect(await store.get(key)).toHaveLength(64);
  });

  test('expired upload and read URLs → 403', async () => {
    const { app, store, sign } = setup();
    const { key, upload } = await sign();
    now += 600_000;
    const put = await request(app).put(upload.url).send(jpeg());
    expect(put.status).toBe(403);
    expect(put.body.error.code).toBe('invalid_signature');
    now = T0;
    expect((await request(app).put(upload.url).send(jpeg())).status).toBe(201);
    const { url } = await store.createReadUrl(key);
    now += 900_000;
    expect((await request(app).get(url)).status).toBe(403);
  });

  test('tampered signatures, parameters, keys or operations → 403', async () => {
    const { app, store, sign } = setup();
    const { key, upload } = await sign();
    const sig = new URL(upload.url, 'http://x').searchParams.get('sig')!;
    const other = (await sign()).key;
    const cases = [
      withParam(upload.url, 'sig', (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)),
      withParam(upload.url, 'exp', String(Math.floor(T0 / 1000) + 99_999)),
      withParam(upload.url, 'max', String(MAX * 10)),
      withParam(upload.url, 'sig', 'short'),
      upload.url.replace(key, other),
      upload.url.split('?')[0]!,
      upload.url.replace('/upload/', '/read/'),
    ];
    for (const url of cases) {
      const r = url.includes('/read/') ? await request(app).get(url) : await request(app).put(url).send(jpeg());
      expect([url, r.status]).toEqual([url, 403]);
    }
    expect(readdirSync(root)).toEqual([]);
    // A read signature cannot be used to upload.
    const { url } = await store.createReadUrl(key);
    expect((await request(app).put(url.replace('/read/', '/upload/')).send(jpeg())).status).toBe(403);
  });

  test('unsigned reads are refused', async () => {
    const { app, sign } = setup();
    const { key, upload } = await sign();
    await request(app).put(upload.url).send(jpeg());
    expect((await request(app).get(`/dev-storage/read/${key}`)).status).toBe(403);
  });
});

describe('content and size validation', () => {
  test('non-images, disguised files, truncated JPEGs and empty bodies → 415; nothing stored', async () => {
    const { app, sign } = setup();
    const bodies = [
      Buffer.from('hello world, definitely not an image'),
      Buffer.from('<html><script>alert(1)</script></html>'),
      jpeg(64).subarray(0, 60),
      Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)]),
      Buffer.alloc(0),
    ];
    for (const b of bodies) {
      const { upload } = await sign();
      const r = await request(app).put(upload.url).set('Content-Type', 'image/jpeg').send(b);
      expect(r.status).toBe(415);
      expect(r.body.error.code).toBe('invalid_image');
    }
    expect(readdirSync(root)).toEqual([]);
  });

  test('size limit: exactly max is accepted, max + 1 → 413', async () => {
    const { app, sign } = setup();
    expect((await request(app).put((await sign()).upload.url).send(jpeg(MAX))).status).toBe(201);
    const r = await request(app).put((await sign()).upload.url).send(jpeg(MAX + 1));
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('payload_too_large');
    expect(readdirSync(root)).toHaveLength(1);
  });

  test('sniffImageType checks content, not names', () => {
    expect(sniffImageType(jpeg())).toBe('image/jpeg');
    expect(sniffImageType(png())).toBe('image/png');
    expect(sniffImageType(webp())).toBe('image/webp');
    const badWebp = webp();
    badWebp.writeUInt32LE(5, 4);
    expect(sniffImageType(badWebp)).toBeNull();
  });
});

describe('path safety', () => {
  test('traversal and malformed keys never reach the filesystem', async () => {
    const { app, store } = setup();
    const keys = ['..%2F..%2Foutside%2Fsecret.txt', '%2e%2e%2fsecret.txt', '..', 'ABCDEF00-0000-4000-8000-000000000000', 'secret.txt', `${'a'.repeat(8)}-0000-4000-8000-000000000000%00`];
    for (const k of keys) {
      for (const op of ['upload', 'read']) {
        const r = op === 'upload' ? await request(app).put(`/dev-storage/upload/${k}?exp=9999999999&max=${MAX}&sig=${'A'.repeat(43)}`).send(jpeg()) : await request(app).get(`/dev-storage/read/${k}?exp=9999999999&sig=${'A'.repeat(43)}`);
        expect([k, op, [403, 404].includes(r.status)]).toEqual([k, op, true]);
        expect(r.text).not.toContain('outside-file-must-never-be-served');
      }
    }
    await expect(store.createReadUrl('../outside/secret.txt')).rejects.toThrow(/invalid key/);
    expect(readdirSync(outside)).toEqual(['secret.txt']);
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });

  test('a symlink planted under a key is never followed or replaced', async () => {
    const { app, store, sign } = setup();
    const { key, upload } = await sign();
    symlinkSync(join(outside, 'secret.txt'), join(root, key));
    const { url } = await store.createReadUrl(key);
    const read = await request(app).get(url);
    expect(read.status).toBe(403);
    expect(read.text).not.toContain('outside-file-must-never-be-served');
    expect((await request(app).put(upload.url).send(jpeg())).status).toBe(409);
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('outside-file-must-never-be-served');
  });
});

describe('storage failures and lifecycle', () => {
  test('a write failure → 503 with no partial object or temp file left', async () => {
    const { app, sign } = setup();
    const { key, upload } = await sign();
    chmodSync(root, 0o500);
    const r = await request(app).put(upload.url).send(jpeg());
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('storage_unavailable');
    chmodSync(root, 0o700);
    expect(readdirSync(root)).toEqual([]);
    expect((await request(app).put(upload.url).send(jpeg())).status).toBe(201);
    expect(readdirSync(root)).toEqual([key]);
  });

  test('/health/ready stays 200 with storage "degraded" when storage is unusable', async () => {
    const { app } = setup();
    expect((await request(app).get('/health/ready')).body.checks.storage).toBe('ok');
    chmodSync(root, 0o500);
    const r = await request(app).get('/health/ready');
    expect(r.status).toBe(200);
    expect(r.body.checks.storage).toBe('degraded');
  });

  test('delete removes the object and is a no-op when it is already gone', async () => {
    const { app, store, sign } = setup();
    const { key, upload } = await sign();
    await request(app).put(upload.url).send(jpeg());
    await store.delete(key);
    expect(existsSync(join(root, key))).toBe(false);
    await expect(store.delete(key)).resolves.toBeUndefined();
    expect(await store.get(key)).toBeNull();
  });

  test('signatures, tokens and image bytes never appear in logs', async () => {
    const { app, store, sign, token } = setup();
    const { key, upload } = await sign();
    await request(app).put(upload.url).send(jpeg());
    const { url } = await store.createReadUrl(key);
    await request(app).get(url);
    await request(app).put(withParam(upload.url, 'sig', 'B'.repeat(43))).send(jpeg());
    const logs = output.join('\n');
    expect(logs).toContain('/dev-storage/upload/');
    for (const secret of [new URL(upload.url, 'http://x').searchParams.get('sig')!, new URL(url, 'http://x').searchParams.get('sig')!, token, SECRET]) {
      expect(logs).not.toContain(secret);
    }
  });
});

describe('driver configuration', () => {
  test('refuses production, short secrets, relative roots and roots inside the repository', () => {
    expect(() => makeStore({ nodeEnv: 'production' })).toThrow(/refuses to start in production/);
    expect(() => makeStore({ secret: 'short' })).toThrow(/at least 32 bytes/);
    expect(() => makeStore({ root: 'relative/photos' })).toThrow(/absolute path/);
    expect(() => makeStore({ forbiddenRoot: base })).toThrow(/outside the repository/);
    const repo = resolve(__dirname, '..', '..', '..');
    expect(() => makeStore({ root: join(repo, 'services', 'api', 'tmp-photos-must-not-exist'), forbiddenRoot: repo })).toThrow(/outside the repository/);
    expect(existsSync(join(repo, 'services', 'api', 'tmp-photos-must-not-exist'))).toBe(false);
    // A root outside the repo that is a symlink into it is refused too.
    symlinkSync(join(repo, 'services', 'api'), join(base, 'link-into-repo'));
    expect(() => makeStore({ root: join(base, 'link-into-repo'), forbiddenRoot: repo })).toThrow(/outside the repository/);
  });

  test('photoStorageFromEnv: unset driver → none; unknown driver, missing settings or bad numbers fail', () => {
    const repo = resolve(__dirname, '..', '..', '..');
    const ok = { STORAGE_DRIVER: 'local', PHOTO_STORAGE_DIR: root, STORAGE_SIGNING_SECRET: SECRET, UPLOAD_CLAIM_SECRET: CLAIM_SECRET, NODE_ENV: 'development' };
    expect(photoStorageFromEnv({}, repo)).toBeNull();
    expect(() => photoStorageFromEnv({ STORAGE_DRIVER: 'supabase' }, repo)).toThrow(/not implemented/);
    expect(() => photoStorageFromEnv({ ...ok, PHOTO_STORAGE_DIR: '' }, repo)).toThrow(/PHOTO_STORAGE_DIR/);
    expect(() => photoStorageFromEnv({ ...ok, STORAGE_SIGNING_SECRET: '' }, repo)).toThrow(/STORAGE_SIGNING_SECRET/);
    expect(() => photoStorageFromEnv({ ...ok, UPLOAD_CLAIM_SECRET: '' }, repo)).toThrow(/UPLOAD_CLAIM_SECRET is required/);
    expect(() => photoStorageFromEnv({ ...ok, UPLOAD_CLAIM_SECRET: SECRET }, repo)).toThrow(/must differ/);
    expect(() => photoStorageFromEnv({ ...ok, UPLOAD_CLAIM_SECRET: 'short' }, repo)).toThrow(/at least 32 bytes/);
    expect(() => photoStorageFromEnv({ ...ok, PHOTO_MAX_BYTES: '0' }, repo)).toThrow(/positive integer/);
    expect(() => photoStorageFromEnv({ ...ok, PHOTO_MAX_BYTES: String(PHOTO_MAX_BYTES + 1) }, repo)).toThrow(/cannot exceed the shared contract/);
    const s = photoStorageFromEnv(ok, repo)!;
    expect(s.store.maxBytes).toBe(512_000);
    expect(PHOTO_MAX_BYTES).toBe(512_000);
  });
});
