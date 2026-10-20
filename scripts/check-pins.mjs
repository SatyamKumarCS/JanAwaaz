// Fails if any workspace package.json uses `latest`, a version range, or a Prisma 8 version.
// D-17 Q1 / D-18 Q6: exact pins everywhere (workspace:* links are allowed).
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync('git ls-files --cached --others --exclude-standard "*package.json"', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.includes('node_modules'));

const REQUIRED = {
  expo: (v) => /^58\.0\.(1[6-9]|[2-9]\d)$/.test(v),
  nativewind: (v) => v === '4.2.7',
  'react-native-reanimated': (v) => v === '4.7.1',
  'react-native-worklets': (v) => v === '0.13.0',
  prisma: (v) => v === '7.10.1',
  '@prisma/client': (v) => v === '7.10.1',
};
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const errors = [];

for (const file of files) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (field === 'peerDependencies') continue; // peers express compatibility ranges by design
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (spec.startsWith('workspace:')) continue;
      if (!EXACT.test(spec)) errors.push(`${file}: ${name}@${spec} is not an exact version`);
      if (name in REQUIRED && !REQUIRED[name](spec)) errors.push(`${file}: ${name}@${spec} violates the approved pin`);
      if ((name === 'prisma' || name.startsWith('@prisma/')) && spec.startsWith('8')) errors.push(`${file}: Prisma 8 is not allowed`);
    }
  }
  if (file === 'package.json') {
    if (pkg.engines?.node !== '24.22.0') errors.push('package.json: engines.node must be 24.22.0');
    if (!/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager ?? '')) errors.push('package.json: packageManager must pin pnpm exactly');
  }
}
const nvmrc = readFileSync('.nvmrc', 'utf8').trim();
if (nvmrc !== '24.22.0') errors.push(`.nvmrc is ${nvmrc}, expected 24.22.0`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`pins OK (${files.length} package.json files)`);
