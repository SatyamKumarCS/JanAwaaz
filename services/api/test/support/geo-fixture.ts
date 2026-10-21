// FAKE geography fixture for I-03a tests. Not real data:
// - district English names are the five pilot names (the validator requires them), but every LGD
//   code is in the reserved fake range 9999xxxx and every other name is "TEST …";
// - coordinates are deliberately far outside India; URLs use the reserved .invalid domain.
// The real seed command refuses this data (manifest "fixture": true + reserved codes).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TARGET_DISTRICTS } from '../../src/geo/dataset';

export type Files = Record<string, string>;

const meta = (as_of = '2026-10-01', licence = 'TEST-ONLY') => ({
  source: 'TEST fixture (not real data)',
  source_url: 'https://example.invalid/geo',
  as_of,
  licence,
});

const csv = (header: string, rows: string[][]) => [header, ...rows.map((r) => r.join(','))].join('\n') + '\n';

/** 5 districts × 2 blocks × 2 villages, 1 GP per block, 1 Nagar Nigam per district (+1 Nagar Panchayat
 * in district 1), 3 wards per Nagar Nigam, 1 zone in district 1's Nagar Nigam (2 wards mapped). */
export function fakeFiles(): Files {
  const d = [1, 2, 3, 4, 5];
  const b = [1, 2];
  const v = [1, 2];
  const districts = d.map((i) => [`9999000${i}`, TARGET_DISTRICTS[i - 1]!, '']);
  const blocks = d.flatMap((i) => b.map((j) => [`99991${i}0${j}`, `9999000${i}`, `TEST Block ${i}-${j}`, '']));
  const villages = d.flatMap((i) =>
    b.flatMap((j) =>
      v.map((k) => [`99992${i}${j}${k}`, `9999000${i}`, `99991${i}0${j}`, `TEST Village ${i}-${j}-${k}`, k === 1 ? `परीक्षण गाँव ${i}-${j}-${k}` : '', `90000${i}${j}${k}`]),
    ),
  );
  const gps = d.flatMap((i) => b.map((j) => [`99993${i}${j}1`, `99991${i}0${j}`, `TEST GP ${i}-${j}`, '']));
  const gpMap = d.flatMap((i) => b.flatMap((j) => v.map((k) => [`99992${i}${j}${k}`, `99993${i}${j}1`, k === 1 ? 'true' : 'false'])));
  const ulbs = [
    ...d.map((i) => [`99994${i}01`, `9999000${i}`, `TEST Nagar Nigam ${i}`, '', 'nagar_nigam']),
    ['99994102', '99990001', 'TEST Nagar Panchayat 1', '', 'nagar_panchayat'],
  ];
  const ulbMap = [
    ['99992111', '99994101', 'full'],
    ['99992112', '99994102', 'partial'],
  ];
  const zones = [['Z1', '99994101', 'TEST Zone 1', '', 'https://example.invalid/zones', '2026-09-01']];
  const wards = d.flatMap((i) =>
    [1, 2, 3].map((w) => [`99995${i}0${w}`, `99994${i}01`, `TEST Ward ${i}-${w}`, '', i === 1 && w < 3 ? 'Z1' : '']),
  );
  // Coordinates for 3 of the 20 villages, plus one row that matches no village.
  const coords = [
    ['90000111', '-45.5', '-120.25'],
    ['90000121', '-45.6', '-120.35'],
    ['90000211', '-45.7', '-120.45'],
    ['9999999', '-45.8', '-120.55'],
  ];
  return {
    'manifest.json': JSON.stringify(
      {
        dataset: 'TEST geography fixture',
        fixture: true,
        files: {
          'districts.csv': meta(),
          'blocks.csv': meta(),
          'villages.csv': meta(),
          'gram_panchayats.csv': meta(),
          'village_gp_map.csv': meta(),
          'ulbs.csv': meta(),
          'village_ulb_map.csv': meta(),
          'zones.csv': meta(),
          'wards.csv': meta('2026-09-15'),
          'village_coords.csv': meta('2026-08-01', 'CC BY-NC-SA 4.0'),
        },
      },
      null,
      2,
    ),
    'districts.csv': csv('lgd_code,name_en,name_hi', districts),
    'blocks.csv': csv('lgd_code,district_lgd_code,name_en,name_hi', blocks),
    'villages.csv': csv('lgd_code,district_lgd_code,block_lgd_code,name_en,name_hi,pc11_code', villages),
    'gram_panchayats.csv': csv('lgd_code,block_lgd_code,name_en,name_hi', gps),
    'village_gp_map.csv': csv('village_lgd_code,gp_lgd_code,is_full', gpMap),
    'ulbs.csv': csv('lgd_code,district_lgd_code,name_en,name_hi,kind', ulbs),
    'village_ulb_map.csv': csv('village_lgd_code,ulb_lgd_code,merge_extent', ulbMap),
    'zones.csv': csv('zone_key,ulb_lgd_code,name_en,name_hi,source_url,as_of', zones),
    'wards.csv': csv('lgd_code,ulb_lgd_code,name_en,name_hi,zone_key', wards),
    'village_coords.csv': csv('pc11_code,lat,lng', coords),
  };
}

/** Edits one JSON manifest in place. */
export function withManifest(files: Files, edit: (m: { files: Record<string, unknown> } & Record<string, unknown>) => void): Files {
  const m = JSON.parse(files['manifest.json']!);
  edit(m);
  return { ...files, 'manifest.json': JSON.stringify(m) };
}

/** Removes a file (and, by default, its manifest entry). */
export function without(files: Files, name: string, keepMeta = false): Files {
  const out = { ...files };
  delete out[name];
  return keepMeta ? out : withManifest(out, (m) => delete m.files[name]);
}

const dirs: string[] = [];
export function writeDataset(files: Files): string {
  const dir = mkdtempSync(join(tmpdir(), 'janawaaz-geo-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
export function cleanupDatasets() {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}
