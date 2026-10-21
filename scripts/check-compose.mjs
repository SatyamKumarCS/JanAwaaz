// I-41 Compose/image policy check (D-18 Q6, Q10; spec §14.4–14.8). Usage: node scripts/check-compose.mjs
//
// - every Compose service sets deploy.resources.limits.memory and none uses mem_limit;
// - every image in compose.yaml, Dockerfile FROM lines and CI workflow `image:` lines is
//   name:exact-tag@sha256:<digest> (no :latest, untagged, major-only/floating tags or missing digest);
// - published ports bind 127.0.0.1 only;
// - the pgvector/postgres image's PG major equals Neon's (18).
//
// Reads `docker compose config` (parse only, nothing is started) using the committed placeholder
// .env.example for interpolation, so no real .env is needed.
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const NEON_PG_MAJOR = '18';
const DIGEST = /@sha256:[0-9a-f]{64}$/;

/** Returns an error message for a non-compliant image reference, or null. */
export function checkImageRef(ref) {
  if (!DIGEST.test(ref)) return `${ref}: missing @sha256 index digest`;
  const nameTag = ref.replace(DIGEST, '');
  const colon = nameTag.lastIndexOf(':');
  const slash = nameTag.lastIndexOf('/');
  if (colon <= slash) return `${ref}: no tag (untagged image)`;
  const tag = nameTag.slice(colon + 1);
  if (/^(latest|lts|stable|current)$/i.test(tag)) return `${ref}: floating tag "${tag}"`;
  if (!/\d+\.\d+/.test(tag)) return `${ref}: major-only or floating tag "${tag}" (needs an exact version)`;
  if (/(^|\/)(pgvector\/pgvector|postgres):/.test(nameTag)) {
    const major = tag.match(/pg(\d+)/)?.[1] ?? tag.match(/^(\d+)/)?.[1];
    if (major !== NEON_PG_MAJOR) return `${ref}: PostgreSQL major ${major ?? '?'} != Neon's ${NEON_PG_MAJOR}`;
  }
  return null;
}

/** Checks the parsed `docker compose config --format json` document. */
export function checkComposeConfig(config) {
  const errors = [];
  for (const [name, svc] of Object.entries(config.services ?? {})) {
    if (svc.mem_limit !== undefined) errors.push(`service ${name}: uses mem_limit (use deploy.resources.limits.memory)`);
    if (svc.deploy?.resources?.limits?.memory === undefined) {
      errors.push(`service ${name}: missing deploy.resources.limits.memory`);
    }
    if (!svc.image) {
      errors.push(`service ${name}: no image reference to pin`);
    } else {
      const e = checkImageRef(svc.image);
      if (e) errors.push(`service ${name}: ${e}`);
    }
    for (const p of svc.ports ?? []) {
      if (p.published !== undefined && p.host_ip !== '127.0.0.1') {
        errors.push(`service ${name}: port ${p.published}->${p.target} is not bound to 127.0.0.1`);
      }
    }
  }
  return errors;
}

/** Image references in Dockerfile FROM lines (skips `scratch` and earlier build stages). */
export function dockerfileImages(text) {
  const stages = new Set();
  const refs = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i);
    if (!m) continue;
    if (m[1] !== 'scratch' && !stages.has(m[1].toLowerCase())) refs.push(m[1]);
    if (m[2]) stages.add(m[2].toLowerCase());
  }
  return refs;
}

/** Image references in CI workflow `image:` keys (job containers and service containers). */
export function workflowImages(text) {
  return [...text.matchAll(/^\s*image:\s*['"]?([^\s'"#]+)/gm)].map((m) => m[1]);
}

function listFiles() {
  return execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function main() {
  const errors = [];
  if (!existsSync('compose.yaml')) {
    errors.push('compose.yaml not found');
  } else {
    const envArgs = existsSync('.env.example') ? ['--env-file', '.env.example'] : [];
    const res = spawnSync('docker', ['compose', ...envArgs, '-f', 'compose.yaml', 'config', '--format', 'json'], {
      encoding: 'utf8',
    });
    if (res.status !== 0) {
      errors.push(`docker compose config failed: ${(res.stderr || res.error?.message || '').trim()}`);
    } else {
      errors.push(...checkComposeConfig(JSON.parse(res.stdout)).map((e) => `compose.yaml: ${e}`));
    }
  }
  const files = listFiles();
  for (const f of files.filter((p) => /(^|\/)Dockerfile[^/]*$/.test(p))) {
    for (const ref of dockerfileImages(readFileSync(f, 'utf8'))) {
      const e = checkImageRef(ref);
      if (e) errors.push(`${f}: ${e}`);
    }
  }
  for (const f of files.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p))) {
    for (const ref of workflowImages(readFileSync(f, 'utf8'))) {
      const e = checkImageRef(ref);
      if (e) errors.push(`${f}: ${e}`);
    }
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('compose/image policy OK');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
