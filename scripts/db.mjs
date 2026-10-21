// Runs the Prisma CLI for services/api against exactly one target (I-02, D-18 Q2).
//
//   node scripts/db.mjs local <prisma args…>   loads ONLY the root .env (never .env.neon)
//   node scripts/db.mjs neon  <prisma args…>   loads ONLY .env.neon (never the root .env)
//   node scripts/db.mjs local --exec <cmd…>     runs <cmd> with the local env (e.g. DB tests);
//                                               --exec is refused for neon
//
// The connection URLs are never printed: output is passed through redact(), the target is shown
// as "local (redacted)" / "neon (redacted)", and `migrate deploy` against Neon needs a typed
// confirmation on an interactive terminal. `--dry-run` reports what would load without running
// Prisma (used by the tests).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';

const URL_KEYS = ['DATABASE_URL', 'DIRECT_URL'];
const TARGETS = {
  local: '.env',
  neon: '.env.neon',
};

/** Replaces every postgres connection string with a fixed placeholder. */
export function redact(text) {
  return String(text).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, 'postgresql://[redacted]');
}

/** Minimal KEY=VALUE parser (no interpolation); ignores comments and blank lines. */
export function parseEnv(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/**
 * Builds the child environment for a target. Inherited URL variables are dropped first, so a
 * shell-exported Neon URL can never leak into a local run (or vice versa). If the target's env
 * file is absent, local runs fall back to the inherited environment (CI provides it); Neon runs
 * refuse.
 */
export function buildEnv(target, cwd, baseEnv) {
  const file = TARGETS[target];
  if (!file) throw new Error(`unknown target "${target}" (expected local | neon)`);
  const path = resolve(cwd, file);
  const env = { ...baseEnv };
  if (existsSync(path)) {
    for (const k of URL_KEYS) delete env[k];
    Object.assign(env, parseEnv(readFileSync(path, 'utf8')));
    return { env, loaded: file };
  }
  if (target === 'neon') throw new Error('.env.neon not found; Neon commands never fall back to other env files');
  return { env, loaded: '(inherited environment)' };
}

function isNeonDeploy(target, args) {
  return target === 'neon' && args[0] === 'migrate' && args[1] === 'deploy';
}

async function main() {
  const [target, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes('--dry-run');
  const args = rest.filter((a) => a !== '--dry-run');
  const cwd = process.cwd();
  let built;
  try {
    built = buildEnv(target, cwd, process.env);
  } catch (err) {
    console.error(`db: ${redact(err.message)}`);
    process.exit(2);
  }
  const missing = URL_KEYS.filter((k) => !built.env[k]);
  console.error(`db: target ${target} (redacted); env from ${built.loaded}`);
  if (dryRun) {
    console.log(JSON.stringify({ target, loaded: built.loaded, missing }));
    return;
  }
  if (missing.length) {
    console.error(`db: missing ${missing.join(', ')}`);
    process.exit(2);
  }
  if (isNeonDeploy(target, args)) {
    if (!process.stdin.isTTY) {
      console.error('db: refusing Neon migrate deploy without an interactive terminal');
      process.exit(3);
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await rl.question('Type "migrate neon" to apply migrations to Neon staging: ');
    rl.close();
    if (answer.trim() !== 'migrate neon') {
      console.error('db: not confirmed; nothing applied');
      process.exit(3);
    }
  }
  const exec = args[0] === '--exec';
  if (exec && target !== 'local') {
    console.error('db: --exec is only allowed for the local target');
    process.exit(2);
  }
  const [cmd, cmdArgs] = exec
    ? [args[1], args.slice(2)]
    : ['pnpm', ['--filter', '@janawaaz/api', 'exec', 'prisma', ...args]];
  const res = spawnSync(cmd, cmdArgs, {
    cwd,
    env: built.env,
    encoding: 'utf8',
  });
  process.stdout.write(redact(res.stdout ?? ''));
  process.stderr.write(redact(res.stderr ?? ''));
  process.exit(res.status ?? 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
