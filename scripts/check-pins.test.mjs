// Pass/fail tests for scripts/check-pins.mjs (D-17 Q1, D-18 Q6). The script runs unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, removeRepo, runGuard } from './guard-test-helpers.mjs';

const ROOT_OK = { name: 'root', engines: { node: '24.22.0' }, packageManager: 'pnpm@10.29.2' };

function pins(pkgs, { nvmrc = '24.22.0', root = ROOT_OK } = {}) {
  const files = { '.nvmrc': `${nvmrc}\n`, 'package.json': JSON.stringify(root) };
  for (const [path, pkg] of Object.entries(pkgs)) files[path] = JSON.stringify(pkg);
  const repo = makeRepo(files);
  try {
    return runGuard('check-pins.mjs', repo);
  } finally {
    removeRepo(repo);
  }
}
const app = (dependencies, extra = {}) => ({ 'apps/x/package.json': { name: 'x', dependencies, ...extra } });

test('passes: exact pins, approved versions, workspace links', () => {
  const r = pins(app({ expo: '58.0.16', nativewind: '4.2.7', prisma: '7.10.1', '@janawaaz/shared': 'workspace:*' }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pins OK \(2 package\.json files\)/);
});

test('passes: later expo SDK 58 patch (58.0.20)', () => {
  assert.equal(pins(app({ expo: '58.0.20' })).status, 0);
});

test('passes: peerDependencies may use ranges', () => {
  assert.equal(pins(app({}, { peerDependencies: { react: '>=18' } })).status, 0);
});

for (const spec of ['^1.2.3', '~1.2.3', 'latest', '*', '>=1.0.0', '1.x']) {
  test(`fails: non-exact spec ${spec}`, () => {
    const r = pins(app({ somepkg: spec }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`somepkg@${spec.replace(/[.*+^$?]/g, '\\$&')} is not an exact version`));
  });
}

test('fails: non-exact spec in devDependencies too', () => {
  const r = pins({ 'apps/x/package.json': { name: 'x', devDependencies: { tool: '^2.0.0' } } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tool@\^2\.0\.0 is not an exact version/);
});

test('fails: expo below the approved 58.0.16 floor', () => {
  const r = pins(app({ expo: '58.0.15' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /expo@58\.0\.15 violates the approved pin/);
});

for (const [name, bad] of [
  ['nativewind', '4.2.6'],
  ['react-native-reanimated', '4.7.0'],
  ['react-native-worklets', '0.12.0'],
  ['@prisma/client', '7.10.0'],
]) {
  test(`fails: ${name}@${bad} violates the approved pin`, () => {
    const r = pins(app({ [name]: bad }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`${name.replace('/', '\\/')}@${bad.replace(/\./g, '\\.')} violates the approved pin`));
  });
}

test('fails: Prisma 8 is rejected', () => {
  const r = pins(app({ prisma: '8.0.0' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Prisma 8 is not allowed/);
});

test('fails: root engines.node must be 24.22.0', () => {
  const r = pins({}, { root: { ...ROOT_OK, engines: { node: '24.21.0' } } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /engines\.node must be 24\.22\.0/);
});

test('fails: root packageManager must pin pnpm exactly', () => {
  const r = pins({}, { root: { ...ROOT_OK, packageManager: 'pnpm@^10' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /packageManager must pin pnpm exactly/);
});

test('fails: .nvmrc must be 24.22.0', () => {
  const r = pins({}, { nvmrc: '26.0.0' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.nvmrc is 26\.0\.0, expected 24\.22\.0/);
});
