// I-03a loader against the throwaway local test database, using the FAKE fixture only.
import { readDataset } from '../src/geo/dataset';
import { createPrismaClient } from '../src/db/client';
import { loadDataset, SeedIntegrityError } from '../src/geo/load';
import { cleanupDatasets, fakeFiles, type Files, without, writeDataset } from '../test/support/geo-fixture';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { targets } = require('./target.cjs') as { targets: () => { testUrl: string } };

const prisma = createPrismaClient(targets().testUrl);
const TODAY = { today: '2026-10-21' };
const load = (files: Files) => loadDataset(prisma, readDataset(writeDataset(files), TODAY));

async function counts() {
  const [r] = await prisma.$queryRaw<Record<string, bigint>[]>`
    SELECT (SELECT count(*) FROM districts)::bigint AS districts, (SELECT count(*) FROM blocks)::bigint AS blocks,
      (SELECT count(*) FROM villages)::bigint AS villages, (SELECT count(*) FROM gram_panchayats)::bigint AS gps,
      (SELECT count(*) FROM village_gp_map)::bigint AS gp_links, (SELECT count(*) FROM ulbs)::bigint AS ulbs,
      (SELECT count(*) FROM zones)::bigint AS zones, (SELECT count(*) FROM wards)::bigint AS wards`;
  return Object.fromEntries(Object.entries(r!).map(([k, v]) => [k, Number(v)]));
}

beforeEach(async () => {
  // Geography tables only (CASCADE also clears rows that reference them in this throwaway database).
  await prisma.$executeRaw`TRUNCATE districts, blocks, villages, gram_panchayats, village_gp_map, ulbs, zones, wards RESTART IDENTITY CASCADE`;
});
afterEach(cleanupDatasets);
afterAll(async () => {
  await prisma.$disconnect();
});

const FULL = { districts: 5, blocks: 10, villages: 20, gps: 10, gp_links: 20, ulbs: 6, zones: 1, wards: 15 };

test('loads the fixture and reports per-district counts, coordinates and zones', async () => {
  const report = await load(fakeFiles());
  expect(await counts()).toEqual(FULL);
  expect(report.districts.map((d) => d.name)).toEqual(['Gorakhpur', 'Varanasi', 'Lucknow', 'Agra', 'Kanpur Nagar']);
  expect(report.districts[0]).toEqual({
    lgd_code: '99990001',
    name: 'Gorakhpur',
    blocks: 2,
    villages: 4,
    villages_missing_hi: 2,
    villages_with_coords: 2,
    villages_without_coords: 2,
    villages_merged_full: 1,
    villages_merged_partial: 1,
    gram_panchayats: 2,
    ulbs: { nagar_nigam: 1, nagar_panchayat: 1 },
  });
  expect(report.coords).toEqual({ file_rows: 4, matched_rows: 3, unmatched_rows: 1, licence: 'CC BY-NC-SA 4.0' });
  expect(report.cities[0]).toEqual({ ulb_lgd_code: '99994101', name: 'TEST Nagar Nigam 1', wards: 3, wards_with_zone: 2, wards_without_zone: ['99995103'], zones: 1 });
  expect(report.cities[1]!.wards_without_zone).toEqual(['99995201', '99995202', '99995203']);
  expect(report.not_in_dataset).toEqual({ districts: 0, blocks: 0, villages: 0, gram_panchayats: 0, ulbs: 0, wards: 0 });

  const [v] = await prisma.$queryRaw<{ area_type: string; coord_source: string | null; merge_extent: string | null; supported: boolean }[]>`
    SELECT v.area_type::text, v.coord_source::text, v.merge_extent::text, u.supported
    FROM villages v JOIN ulbs u ON u.id = v.merged_ulb_id WHERE v.lgd_code = '99992111'`;
  expect(v).toEqual({ area_type: 'rural', coord_source: 'shrug_pc11', merge_extent: 'full', supported: true });
  const [w] = await prisma.$queryRaw<{ as_of: string }[]>`SELECT as_of::text FROM wards WHERE lgd_code = '99995101'`;
  expect(w!.as_of).toBe('2026-09-15');
});

test('running twice yields identical rows, ids and report', async () => {
  const first = await load(fakeFiles());
  const idsBefore = await prisma.$queryRaw<{ lgd_code: string; id: number }[]>`SELECT lgd_code, id FROM villages ORDER BY lgd_code`;
  const second = await load(fakeFiles());
  expect(await counts()).toEqual(FULL);
  expect(second).toEqual(first);
  expect(await prisma.$queryRaw`SELECT lgd_code, id FROM villages ORDER BY lgd_code`).toEqual(idsBefore);
});

test('a renamed ward keeps its row (same LGD code, same id)', async () => {
  await load(fakeFiles());
  const [before] = await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM wards WHERE lgd_code = '99995101'`;
  const files = fakeFiles();
  await load({ ...files, 'wards.csv': files['wards.csv']!.replace('99995101,99994101,TEST Ward 1-1,', '99995101,99994101,TEST Ward 1-1 renamed,') });
  const rows = await prisma.$queryRaw<{ id: number; name_en: string }[]>`SELECT id, name_en FROM wards WHERE lgd_code = '99995101'`;
  expect(rows).toEqual([{ id: before!.id, name_en: 'TEST Ward 1-1 renamed' }]);
  expect((await counts()).wards).toBe(15);
});

test('derived links follow the dataset: removing coordinates and zone links clears them on rerun', async () => {
  await load(fakeFiles());
  const files = fakeFiles();
  const report = await load({
    ...without(files, 'village_coords.csv'),
    'wards.csv': files['wards.csv']!.replace(/,Z1\n/g, ',\n'),
  });
  expect(report.districts.every((d) => d.villages_with_coords === 0)).toBe(true);
  expect(report.cities[0]!.wards_with_zone).toBe(0);
  expect(report.cities[0]!.wards_without_zone).toEqual(['99995101', '99995102', '99995103']);
  const [c] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM villages WHERE coord_source IS NOT NULL OR lat IS NOT NULL`;
  expect(Number(c!.n)).toBe(0);
  expect((await counts()).zones).toBe(1); // the zone row itself is kept
});

test('rows dropped from the dataset are reported, never deleted', async () => {
  await load(fakeFiles());
  const files = fakeFiles();
  const report = await load({ ...files, 'wards.csv': files['wards.csv']!.replace('99995503,99994501,TEST Ward 5-3,,\n', '') });
  expect(report.not_in_dataset.wards).toBe(1);
  expect((await counts()).wards).toBe(15);
});

test('an extra district already in the database rolls the whole load back', async () => {
  await prisma.$executeRaw`INSERT INTO districts (lgd_code, name) VALUES ('99990009', 'TEST Extra District')`;
  await expect(load(fakeFiles())).rejects.toThrow(SeedIntegrityError);
  await expect(load(fakeFiles())).rejects.toThrow(/exactly 5 pilot districts/);
  expect(await counts()).toEqual({ districts: 1, blocks: 0, villages: 0, gps: 0, gp_links: 0, ulbs: 0, zones: 0, wards: 0 });
});

test('a database-level failure mid-load writes nothing', async () => {
  await load(fakeFiles());
  const before = await counts();
  const names = await prisma.$queryRaw`SELECT lgd_code, name_en FROM wards ORDER BY lgd_code`;
  // Make the ward upsert fail after districts/blocks/villages were already upserted in the same transaction.
  await prisma.$executeRaw`ALTER TABLE wards ADD CONSTRAINT i03a_test_block CHECK (name_en NOT LIKE '%FAIL%') NOT VALID`;
  try {
    const files = fakeFiles();
    const edited = {
      ...files,
      'villages.csv': files['villages.csv']!.replace('TEST Village 1-1-1', 'TEST Village 1-1-1 changed'),
      'wards.csv': files['wards.csv']!.replace('TEST Ward 1-1', 'TEST Ward 1-1 FAIL'),
    };
    await expect(load(edited)).rejects.toThrow();
  } finally {
    await prisma.$executeRaw`ALTER TABLE wards DROP CONSTRAINT i03a_test_block`;
  }
  expect(await counts()).toEqual(before);
  const [v] = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM villages WHERE lgd_code = '99992111'`;
  expect(v!.name).toBe('TEST Village 1-1-1');
  expect(await prisma.$queryRaw`SELECT lgd_code, name_en FROM wards ORDER BY lgd_code`).toEqual(names);
});
