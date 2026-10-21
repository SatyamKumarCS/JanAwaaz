// Tests for scripts/check-compose.mjs (I-41: D-18 Q6/Q10). Fixture repos are parsed with
// `docker compose config` only; no container is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkImageRef, checkRuntimeVersion } from './check-compose.mjs';
import { makeRepo, removeRepo, runGuard } from './guard-test-helpers.mjs';

const D = '@sha256:' + 'a'.repeat(64);
const PG = `pgvector/pgvector:0.8.7-pg18-trixie${D}`;

function compose({ image = PG, ports = '      - "127.0.0.1:5432:5432"\n', limits = true, memLimit = false } = {}) {
  return [
    'services:',
    '  db:',
    `    image: ${image}`,
    ...(ports ? ['    ports:', ports.trimEnd()] : []),
    ...(memLimit ? ['    mem_limit: 512m'] : []),
    ...(limits ? ['    deploy:', '      resources:', '        limits:', '          memory: 512M'] : []),
    '',
  ].join('\n');
}

function without(files, key) {
  const copy = { ...files };
  delete copy[key];
  return copy;
}

function check(files) {
  const repo = makeRepo(files);
  try {
    return runGuard('check-compose.mjs', repo);
  } finally {
    removeRepo(repo);
  }
}

const GOOD = {
  '.nvmrc': '24.22.0\n',
  'services/ai/.python-version': '3.13\n',
  'compose.yaml': compose(),
  '.github/workflows/ci.yml': `jobs:\n  t:\n    services:\n      db:\n        image: ${PG}\n`,
  'services/api/Dockerfile': `FROM node:24.22.0-trixie-slim${D} AS dev\nFROM dev AS prod\n`,
  'services/ai/Dockerfile': `FROM python:3.13.16-slim-trixie${D} AS dev\n`,
};

test('passes: pinned images, memory limits, loopback port', () => {
  const r = check(GOOD);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /compose\/image policy OK/);
});

test('fails: service without deploy.resources.limits.memory', () => {
  const r = check({ ...GOOD, 'compose.yaml': compose({ limits: false }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /service db: missing deploy\.resources\.limits\.memory/);
});

test('fails: service using mem_limit', () => {
  const r = check({ ...GOOD, 'compose.yaml': compose({ limits: false, memLimit: true }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /service db: uses mem_limit/);
});

test('fails: published port not bound to 127.0.0.1', () => {
  const r = check({ ...GOOD, 'compose.yaml': compose({ ports: '      - "5432:5432"\n' }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /port 5432->5432 is not bound to 127\.0\.0\.1/);
});

test('fails: compose image without digest', () => {
  const r = check({ ...GOOD, 'compose.yaml': compose({ image: 'pgvector/pgvector:0.8.7-pg18-trixie' }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing @sha256 index digest/);
});

test('fails: compose image with :latest', () => {
  const r = check({ ...GOOD, 'compose.yaml': compose({ image: `pgvector/pgvector:latest${D}` }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /floating tag "latest"/);
});

test('fails: PostgreSQL major different from Neon (17)', () => {
  const r = check({ ...GOOD, 'compose.yaml': compose({ image: `pgvector/pgvector:0.8.7-pg17-trixie${D}` }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PostgreSQL major 17 != Neon's 18/);
});

test('fails: Dockerfile FROM with a major-only tag (node:24)', () => {
  const r = check({ ...GOOD, 'services/api/Dockerfile': `FROM node:24${D}\n` });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /services\/api\/Dockerfile: .*major-only or floating tag "24"/);
});

test('fails: CI workflow service image with a floating tag (python:3-slim)', () => {
  const r = check({ ...GOOD, '.github/workflows/ci.yml': `jobs:\n  t:\n    container:\n      image: python:3-slim${D}\n` });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.github\/workflows\/ci\.yml: .*major-only or floating tag "3-slim"/);
});

test('checkImageRef rules', () => {
  assert.equal(checkImageRef(PG), null);
  assert.equal(checkImageRef(`node:24.22.0-trixie-slim${D}`), null);
  assert.equal(checkImageRef(`axllent/mailpit:v1.31.6${D}`), null);
  assert.match(checkImageRef(`node${D}`), /untagged/);
  assert.match(checkImageRef(`node:lts${D}`), /floating tag "lts"/);
  assert.match(checkImageRef('node:24.22.0'), /missing @sha256/);
  assert.match(checkImageRef(`localhost:5000/app${D}`), /untagged/);
  assert.match(checkImageRef(`postgres:17.6${D}`), /PostgreSQL major 17/);
});

test('fails: Dockerfile node image major differs from .nvmrc (26 vs 24)', () => {
  const r = check({ ...GOOD, 'services/api/Dockerfile': `FROM node:26.1.0-trixie-slim${D}\n` });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /services\/api\/Dockerfile: .*Node major 26 != \.nvmrc major 24/);
});

test('fails: compose python image differs from .python-version (3.14 vs 3.13)', () => {
  const r = check({ ...GOOD, 'compose.yaml': compose({ image: `python:3.14.0-slim-trixie${D}` }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /compose\.yaml: service db: .*Python 3\.14 != services\/ai\/\.python-version 3\.13/);
});

test('fails: CI workflow docker.io/library/node image with a different major', () => {
  const r = check({ ...GOOD, '.github/workflows/ci.yml': `jobs:\n  t:\n    container:\n      image: docker.io/library/node:22.11.0${D}\n` });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.github\/workflows\/ci\.yml: .*Node major 22 != \.nvmrc major 24/);
});

test('fails clearly: missing .nvmrc', () => {
  const r = check(without(GOOD, '.nvmrc'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\.nvmrc: missing$/m);
});

test('fails clearly: missing services/ai/.python-version', () => {
  const r = check(without(GOOD, 'services/ai/.python-version'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^services\/ai\/\.python-version: missing$/m);
});

test('fails clearly: invalid version files', () => {
  const r = check({ ...GOOD, '.nvmrc': 'lts/*\n', 'services/ai/.python-version': '3\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.nvmrc: invalid Node version "lts\/\*"/);
  assert.match(r.stderr, /services\/ai\/\.python-version: invalid Python version "3"/);
});

test('checkRuntimeVersion: official name variants and non-official images', () => {
  const v = { node: '24', python: '3.13' };
  for (const name of ['node', 'library/node', 'docker.io/library/node', 'index.docker.io/library/node']) {
    assert.equal(checkRuntimeVersion(`${name}:24.22.0-trixie-slim${D}`, v), null, name);
    assert.match(checkRuntimeVersion(`${name}:26.0.0${D}`, v), /Node major 26/, name);
  }
  for (const name of ['python', 'library/python', 'docker.io/library/python', 'registry-1.docker.io/library/python']) {
    assert.equal(checkRuntimeVersion(`${name}:3.13.16-slim-trixie${D}`, v), null, name);
    assert.match(checkRuntimeVersion(`${name}:3.14.0${D}`, v), /Python 3\.14/, name);
  }
  assert.match(checkRuntimeVersion(`python:3-slim${D}`, v), /Python \? != /);
  assert.equal(checkRuntimeVersion(`myorg/node:20.1.0${D}`, v), null);
  assert.equal(checkRuntimeVersion(`ghcr.io/acme/python:3.12.1${D}`, v), null);
  assert.equal(checkRuntimeVersion(PG, v), null);
});
