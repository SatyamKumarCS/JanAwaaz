// Real geography seed (I-03): `pnpm db:seed:geo <dataset-dir> [--report <file>]`.
// Runs only against the local database (scripts/db.mjs refuses --exec for Neon). Refuses fixtures.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrismaClient } from '../db/client';
import { DatasetError, readDataset } from './dataset';
import { fixtureReasons } from './guard';
import { loadDataset, SeedIntegrityError } from './load';

async function main() {
  const args = process.argv.slice(2);
  const reportIdx = args.indexOf('--report');
  const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : undefined;
  const dirArg = args.find((a, i) => !a.startsWith('--') && (reportIdx < 0 || i !== reportIdx + 1));
  if (!dirArg || (reportIdx >= 0 && !reportPath)) {
    console.error('usage: pnpm db:seed:geo <dataset-dir> [--report <file>]  (format: services/api/prisma/geo/FORMAT.md)');
    process.exit(2);
  }
  // pnpm runs this inside services/api; resolve paths against where the user ran the command.
  const base = process.env.INIT_CWD ?? process.cwd();
  const dir = resolve(base, dirArg);

  const ds = readDataset(dir);
  const reasons = fixtureReasons(ds, dir);
  if (reasons.length) {
    console.error(`geo seed: refusing to load test fixtures:\n- ${reasons.join('\n- ')}`);
    process.exit(2);
  }
  const prisma = createPrismaClient();
  try {
    const report = await loadDataset(prisma, ds);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (reportPath) writeFileSync(resolve(base, reportPath), json);
    console.log(json);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  if (err instanceof DatasetError || err instanceof SeedIntegrityError) {
    console.error(`geo seed: ${err.message}`);
    process.exit(1);
  }
  console.error('geo seed: unexpected failure; nothing was committed');
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  process.exit(1);
});
