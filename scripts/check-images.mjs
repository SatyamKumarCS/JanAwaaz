// Blocks image files outside the allowed folders and any file above the size limit (D-08 Q6),
// so private photos can never be committed. Usage: node scripts/check-images.mjs [--staged]
import { execSync } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';

const staged = process.argv.includes('--staged');
const cmd = staged
  ? 'git diff --cached --name-only --diff-filter=ACMR'
  : 'git ls-files --cached --others --exclude-standard';
const files = execSync(cmd, { encoding: 'utf8' }).split('\n').filter(Boolean);

const IMAGE = /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i;
// Allowed: Expo app icons/splash (template assets) and the manifested fixture folder.
const ALLOWED_IMAGE_DIRS = ['apps/mobile/assets/', 'services/ai/eval/fixtures/photos/'];
const MAX_BYTES = 1_000_000; // 1 MB per file (lockfiles excepted)
const SIZE_EXEMPT = new Set(['pnpm-lock.yaml', 'services/ai/uv.lock']);
const errors = [];

for (const f of files) {
  if (!existsSync(f)) continue;
  if (IMAGE.test(f) && !ALLOWED_IMAGE_DIRS.some((d) => f.startsWith(d))) {
    errors.push(`${f}: image outside the allowed folders`);
  }
  const size = statSync(f).size;
  if (size > MAX_BYTES && !SIZE_EXEMPT.has(f)) errors.push(`${f}: ${size} bytes exceeds ${MAX_BYTES}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`images/size OK (${files.length} files checked)`);
