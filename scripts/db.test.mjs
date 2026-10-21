// Tests for scripts/db.mjs (I-02, D-18 Q2): one env file per target, never cross-loaded,
// URLs redacted, and Neon deploys guarded. No database is contacted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnv, parseEnv, redact } from './db.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'db.mjs');
const LOCAL = 'postgresql://local-user:local-pass@localhost:5433/janawaaz';
const NEON = 'postgresql://neon-user:neon-pass@ep-example.neon.tech/db?sslmode=require';

function workdir({ local = true, neon = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'janawaaz-db-'));
  if (local) writeFileSync(join(dir, '.env'), `DATABASE_URL=${LOCAL}\nDIRECT_URL=${LOCAL}\n`);
  if (neon) writeFileSync(join(dir, '.env.neon'), `DATABASE_URL=${NEON}\nDIRECT_URL=${NEON}\n`);
  return dir;
}

function run(dir, args, env = {}) {
  const base = { ...process.env };
  delete base.DATABASE_URL;
  delete base.DIRECT_URL;
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env: { ...base, ...env } });
}

test('local loads only .env, even when .env.neon exists', () => {
  const dir = workdir();
  try {
    const { env, loaded } = buildEnv('local', dir, {});
    assert.equal(loaded, '.env');
    assert.equal(env.DATABASE_URL, LOCAL);
    assert.equal(env.DIRECT_URL, LOCAL);
    assert.ok(!Object.values(env).some((v) => String(v).includes('neon')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local drops a shell-exported Neon URL instead of using it', () => {
  const dir = workdir();
  try {
    const { env } = buildEnv('local', dir, { DATABASE_URL: NEON, DIRECT_URL: NEON });
    assert.equal(env.DATABASE_URL, LOCAL);
    assert.equal(env.DIRECT_URL, LOCAL);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local without .env never falls back to .env.neon', () => {
  const dir = workdir({ local: false });
  try {
    const { env, loaded } = buildEnv('local', dir, {});
    assert.equal(loaded, '(inherited environment)');
    assert.equal(env.DATABASE_URL, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('neon loads only .env.neon, even when .env exists', () => {
  const dir = workdir();
  try {
    const { env, loaded } = buildEnv('neon', dir, {});
    assert.equal(loaded, '.env.neon');
    assert.equal(env.DIRECT_URL, NEON);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('neon refuses when .env.neon is missing (exit 2), even if .env exists', () => {
  const dir = workdir({ neon: false });
  try {
    const r = run(dir, ['neon', 'migrate', 'status']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\.env\.neon not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('neon migrate deploy is refused without an interactive terminal (exit 3)', () => {
  const dir = workdir();
  try {
    const r = run(dir, ['neon', 'migrate', 'deploy']);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /refusing Neon migrate deploy without an interactive terminal/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--exec is refused for neon (exit 2)', () => {
  const dir = workdir();
  try {
    const r = run(dir, ['neon', '--exec', 'echo', 'hi']);
    assert.equal(r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('output shows the target as redacted and never prints a URL', () => {
  const dir = workdir();
  try {
    for (const target of ['local', 'neon']) {
      const r = run(dir, [target, 'migrate', 'status', '--dry-run']);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, new RegExp(`target ${target} \\(redacted\\)`));
      const all = r.stdout + r.stderr;
      assert.ok(!all.includes('pass@'), 'credentials leaked');
      assert.doesNotMatch(all, /postgres(ql)?:\/\/(?!\[redacted\])/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('redact and parseEnv', () => {
  assert.equal(redact(`x ${NEON} y`), 'x postgresql://[redacted] y');
  assert.deepEqual(parseEnv('# c\nA=1\nB="two"\n\nbad line\n'), { A: '1', B: 'two' });
});
