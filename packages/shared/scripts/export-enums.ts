import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENUMS } from '../src/enums';

// Run from the package directory (pnpm --filter @janawaaz/shared run export-enums).
const out = resolve(process.cwd(), 'enums.json');
writeFileSync(out, JSON.stringify(ENUMS, null, 2) + '\n');
console.log(`wrote ${out}`);
