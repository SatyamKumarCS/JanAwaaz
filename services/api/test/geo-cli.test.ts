// I-03a: the real seed command refuses the fake fixture before touching any database.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cleanupDatasets, fakeFiles, withManifest, writeDataset } from './support/geo-fixture';

const API = resolve(__dirname, '..');
const run = (args: string[]) =>
  spawnSync(resolve(API, 'node_modules', '.bin', 'tsx'), ['src/geo/seed-cli.ts', ...args], {
    cwd: API,
    encoding: 'utf8',
    // No database URL at all: a refusal must happen before any connection is attempted.
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
  });

afterEach(cleanupDatasets);

test('refuses the fixture dataset (exit 2) without connecting to a database', () => {
  const r = run([writeDataset(fakeFiles())]);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/refusing to load test fixtures/);
  expect(r.stderr).toMatch(/marks this dataset as a test fixture/);
  expect(r.stderr).not.toMatch(/DATABASE_URL/);
});

test('still refuses when the fixture flag is removed (reserved fake codes)', () => {
  const r = run([writeDataset(withManifest(fakeFiles(), (m) => delete m.fixture))]);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/reserved fake LGD code/);
});

test('an invalid dataset fails with actionable, line-numbered errors', () => {
  const files = fakeFiles();
  const r = run([writeDataset({ ...files, 'blocks.csv': files['blocks.csv']!.replace('99991101,99990001,', '99991101,99990009,') })]);
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/blocks\.csv:2: district_lgd_code "99990009" not in districts\.csv/);
});

test('prints usage without a dataset directory', () => {
  const r = run([]);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/usage: pnpm db:seed:geo/);
});

test('finds the dataset directory whether --report comes before or after it', () => {
  const dir = writeDataset(fakeFiles());
  for (const args of [['--report', 'out.json', dir], [dir, '--report', 'out.json']]) {
    const r = run(args);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/refusing to load test fixtures/);
  }
  expect(run([dir, '--report']).stderr).toMatch(/usage/);
});
