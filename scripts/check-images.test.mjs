// Pass/fail tests for scripts/check-images.mjs (D-08 Q6). The script runs unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitAdd, makeRepo, removeRepo, runGuard } from './guard-test-helpers.mjs';

const MB = 1_000_000;
const bytes = (n) => Buffer.alloc(n, 0x61);

function images(files, { staged = null } = {}) {
  const repo = makeRepo(files);
  try {
    if (staged) gitAdd(repo, staged);
    return runGuard('check-images.mjs', repo, staged ? ['--staged'] : []);
  } finally {
    removeRepo(repo);
  }
}

test('passes: images in the allowed folders, small files', () => {
  const r = images({
    'apps/mobile/assets/icon.png': bytes(10),
    'services/ai/eval/fixtures/photos/road.jpg': bytes(10),
    'README.md': 'hello',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /images\/size OK \(3 files checked\)/);
});

for (const path of ['photo.jpg', 'apps/dashboard/public/x.png', 'docs/IMG_0001.HEIC', 'a/b.webp', 'c.tiff']) {
  test(`fails: image outside allowed folders (${path})`, () => {
    const r = images({ [path]: bytes(10) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`${path.replace(/[./]/g, '\\$&')}: image outside the allowed folders`));
  });
}

test('passes: file exactly at the 1 MB limit', () => {
  assert.equal(images({ 'data.bin': bytes(MB) }).status, 0);
});

test('fails: file above the 1 MB limit', () => {
  const r = images({ 'data.bin': bytes(MB + 1) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /data\.bin: 1000001 bytes exceeds 1000000/);
});

test('passes: lockfiles are exempt from the size limit', () => {
  const r = images({ 'pnpm-lock.yaml': bytes(MB + 1), 'services/ai/uv.lock': bytes(MB + 1) });
  assert.equal(r.status, 0, r.stderr);
});

test('--staged: only staged files are checked', () => {
  const r = images({ 'ok.txt': 'x', 'unstaged.png': bytes(10) }, { staged: ['ok.txt'] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(1 files checked\)/);
});

test('--staged: a staged image outside allowed folders fails', () => {
  const r = images({ 'leak.jpg': bytes(10) }, { staged: ['leak.jpg'] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /leak\.jpg: image outside the allowed folders/);
});
