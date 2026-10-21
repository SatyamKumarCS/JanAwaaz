// Shared helpers for the guard-script tests: run a guard script unchanged, as a CLI,
// inside a throwaway git repository built from fixture files.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Creates a temp git repo containing `files` ({ path: string | Buffer }); returns its path. */
export function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'janawaaz-guard-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

/** Runs scripts/<script> with cwd = repo; returns { status, stdout, stderr }. */
export function runGuard(script, repo, args = []) {
  const res = spawnSync(process.execPath, [resolve(SCRIPTS_DIR, script), ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

export function removeRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function gitAdd(repo, paths) {
  execFileSync('git', ['add', '--', ...paths], { cwd: repo });
}
