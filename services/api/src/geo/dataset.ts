// Geography dataset (I-03): reading and validating a dataset directory before anything touches the
// database. Format: services/api/prisma/geo/FORMAT.md. Every error names file and line.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv';

export const TARGET_DISTRICTS = ['Gorakhpur', 'Varanasi', 'Lucknow', 'Agra', 'Kanpur Nagar'] as const;

/** Fake codes for test fixtures: 8 digits starting 9999 (real LGD codes are shorter). */
export const RESERVED_FAKE_CODE = /^9999\d{4}$/;

export const COORDS_LICENCE = 'CC BY-NC-SA 4.0';
const ULB_KINDS = ['nagar_nigam', 'nagar_palika_parishad', 'nagar_panchayat'] as const;
type UlbKind = (typeof ULB_KINDS)[number];

export const FILES = {
  'districts.csv': ['lgd_code', 'name_en', 'name_hi'],
  'blocks.csv': ['lgd_code', 'district_lgd_code', 'name_en', 'name_hi'],
  'villages.csv': ['lgd_code', 'district_lgd_code', 'block_lgd_code', 'name_en', 'name_hi', 'pc11_code'],
  'gram_panchayats.csv': ['lgd_code', 'block_lgd_code', 'name_en', 'name_hi'],
  'village_gp_map.csv': ['village_lgd_code', 'gp_lgd_code', 'is_full'],
  'ulbs.csv': ['lgd_code', 'district_lgd_code', 'name_en', 'name_hi', 'kind'],
  'village_ulb_map.csv': ['village_lgd_code', 'ulb_lgd_code', 'merge_extent'],
  'zones.csv': ['zone_key', 'ulb_lgd_code', 'name_en', 'name_hi', 'source_url', 'as_of'],
  'wards.csv': ['lgd_code', 'ulb_lgd_code', 'name_en', 'name_hi', 'zone_key'],
  'village_coords.csv': ['pc11_code', 'lat', 'lng'],
} as const;
export type FileName = keyof typeof FILES;
const REQUIRED: FileName[] = ['districts.csv', 'blocks.csv', 'villages.csv'];

export interface FileMeta {
  source: string;
  source_url: string;
  as_of: string;
  licence: string;
}
export interface Manifest {
  dataset: string;
  fixture?: boolean;
  files: Partial<Record<FileName, FileMeta>>;
}

export interface District { line: number; lgd_code: string; name_en: string; name_hi: string | null }
export interface Block { line: number; lgd_code: string; district: string; name_en: string; name_hi: string | null }
export interface VillageRow {
  line: number; lgd_code: string; district: string; block: string; name_en: string; name_hi: string | null; pc11: string | null;
}
export interface Gp { line: number; lgd_code: string; block: string; name_en: string; name_hi: string | null }
export interface GpLink { line: number; village: string; gp: string; is_full: boolean }
export interface Ulb { line: number; lgd_code: string; district: string; name_en: string; name_hi: string | null; kind: UlbKind }
export interface UlbLink { line: number; village: string; ulb: string; extent: 'full' | 'partial' }
export interface ZoneRow {
  line: number; key: string; ulb: string; name_en: string; name_hi: string | null; source_url: string; as_of: string;
}
export interface WardRow { line: number; lgd_code: string; ulb: string; name_en: string; name_hi: string | null; zone: string | null }
export interface Coord { line: number; pc11: string; lat: number; lng: number }

export interface Dataset {
  manifest: Manifest;
  districts: District[];
  blocks: Block[];
  villages: VillageRow[];
  gps: Gp[];
  gpLinks: GpLink[];
  ulbs: Ulb[];
  ulbLinks: UlbLink[];
  zones: ZoneRow[];
  wards: WardRow[];
  coords: Coord[];
  present: FileName[];
}

export class DatasetError extends Error {
  constructor(readonly errors: string[]) {
    super(`geography dataset is invalid (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${errors.join('\n')}`);
    this.name = 'DatasetError';
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIGITS = /^\d+$/;

function validDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** Reads and validates a dataset directory. Throws DatasetError listing every problem found. */
export function readDataset(dir: string, opts: { today?: string } = {}): Dataset {
  const errors: string[] = [];
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new DatasetError([`manifest.json: missing in ${dir}`]);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch (err) {
    throw new DatasetError([`manifest.json: not valid JSON (${(err as Error).message})`]);
  }
  if (!manifest || typeof manifest.dataset !== 'string' || !manifest.dataset.trim()) {
    errors.push('manifest.json: "dataset" (a non-empty name) is required');
  }
  const metaFiles = manifest?.files && typeof manifest.files === 'object' ? manifest.files : {};
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const csvs = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
  for (const f of csvs) {
    if (!(f in FILES)) errors.push(`${f}: unknown file (expected one of ${Object.keys(FILES).join(', ')})`);
  }
  const present = csvs.filter((f): f is FileName => f in FILES);
  for (const f of REQUIRED) if (!present.includes(f)) errors.push(`${f}: required file is missing`);

  for (const f of present) {
    const m = (metaFiles as Record<string, Partial<FileMeta> | undefined>)[f];
    if (!m) {
      errors.push(`manifest.json: no source metadata for ${f}`);
      continue;
    }
    for (const k of ['source', 'source_url', 'as_of', 'licence'] as const) {
      if (typeof m[k] !== 'string' || !m[k]!.trim()) errors.push(`manifest.json: ${f}.${k} is required`);
    }
    if (m.source_url && !/^https:\/\//.test(m.source_url)) errors.push(`manifest.json: ${f}.source_url must be https`);
    if (m.as_of && (!validDate(m.as_of) || m.as_of > today)) {
      errors.push(`manifest.json: ${f}.as_of must be a real past date YYYY-MM-DD`);
    }
  }
  for (const f of Object.keys(metaFiles)) {
    if (!present.includes(f as FileName)) errors.push(`manifest.json: metadata for ${f}, but the file is missing`);
  }
  const coordsMeta = (metaFiles as Record<string, Partial<FileMeta> | undefined>)['village_coords.csv'];
  if (present.includes('village_coords.csv') && coordsMeta?.licence && coordsMeta.licence !== COORDS_LICENCE) {
    errors.push(`manifest.json: village_coords.csv.licence must be "${COORDS_LICENCE}" (licence gate, D-06 Q4)`);
  }
  // Dependent files.
  const need = (f: FileName, on: FileName) => {
    if (present.includes(f) && !present.includes(on)) errors.push(`${f}: requires ${on}`);
  };
  need('village_gp_map.csv', 'gram_panchayats.csv');
  need('gram_panchayats.csv', 'village_gp_map.csv');
  need('village_ulb_map.csv', 'ulbs.csv');
  need('wards.csv', 'ulbs.csv');
  need('zones.csv', 'wards.csv');

  const rows = (f: FileName): { line: number; get: (k: string) => string }[] => {
    if (!present.includes(f)) return [];
    let table;
    try {
      table = parseCsv(readFileSync(join(dir, f), 'utf8'));
    } catch (err) {
      errors.push(`${f}: ${(err as Error).message}`);
      return [];
    }
    const expected = FILES[f] as readonly string[];
    if (table.header.join(',') !== expected.join(',')) {
      errors.push(`${f}:1: header must be exactly "${expected.join(',')}"`);
      return [];
    }
    const out = [];
    for (const r of table.rows) {
      if (r.values.length !== expected.length) {
        errors.push(`${f}:${r.line}: expected ${expected.length} fields, found ${r.values.length}`);
        continue;
      }
      out.push({ line: r.line, get: (k: string) => (r.values[expected.indexOf(k)] ?? '').trim() });
    }
    return out;
  };
  const opt = (s: string) => (s === '' ? null : s);
  const code = (f: string, line: number, k: string, v: string) => {
    if (!DIGITS.test(v)) errors.push(`${f}:${line}: ${k} "${v}" must be a numeric LGD code`);
    return v;
  };
  const named = (f: string, line: number, v: string) => {
    if (!v) errors.push(`${f}:${line}: name_en is required`);
    return v;
  };

  const ds: Dataset = {
    manifest,
    present,
    districts: rows('districts.csv').map((r) => ({
      line: r.line,
      lgd_code: code('districts.csv', r.line, 'lgd_code', r.get('lgd_code')),
      name_en: named('districts.csv', r.line, r.get('name_en')),
      name_hi: opt(r.get('name_hi')),
    })),
    blocks: rows('blocks.csv').map((r) => ({
      line: r.line,
      lgd_code: code('blocks.csv', r.line, 'lgd_code', r.get('lgd_code')),
      district: r.get('district_lgd_code'),
      name_en: named('blocks.csv', r.line, r.get('name_en')),
      name_hi: opt(r.get('name_hi')),
    })),
    villages: rows('villages.csv').map((r) => {
      const pc11 = opt(r.get('pc11_code'));
      if (pc11 && !DIGITS.test(pc11)) errors.push(`villages.csv:${r.line}: pc11_code "${pc11}" must be numeric`);
      return {
        line: r.line,
        lgd_code: code('villages.csv', r.line, 'lgd_code', r.get('lgd_code')),
        district: r.get('district_lgd_code'),
        block: r.get('block_lgd_code'),
        name_en: named('villages.csv', r.line, r.get('name_en')),
        name_hi: opt(r.get('name_hi')),
        pc11,
      };
    }),
    gps: rows('gram_panchayats.csv').map((r) => ({
      line: r.line,
      lgd_code: code('gram_panchayats.csv', r.line, 'lgd_code', r.get('lgd_code')),
      block: r.get('block_lgd_code'),
      name_en: named('gram_panchayats.csv', r.line, r.get('name_en')),
      name_hi: opt(r.get('name_hi')),
    })),
    gpLinks: rows('village_gp_map.csv').map((r) => {
      const f = r.get('is_full');
      if (f !== 'true' && f !== 'false') errors.push(`village_gp_map.csv:${r.line}: is_full must be true or false`);
      return { line: r.line, village: r.get('village_lgd_code'), gp: r.get('gp_lgd_code'), is_full: f === 'true' };
    }),
    ulbs: rows('ulbs.csv').map((r) => {
      const kind = r.get('kind');
      if (!(ULB_KINDS as readonly string[]).includes(kind)) {
        errors.push(`ulbs.csv:${r.line}: kind "${kind}" must be one of ${ULB_KINDS.join(', ')}`);
      }
      return {
        line: r.line,
        lgd_code: code('ulbs.csv', r.line, 'lgd_code', r.get('lgd_code')),
        district: r.get('district_lgd_code'),
        name_en: named('ulbs.csv', r.line, r.get('name_en')),
        name_hi: opt(r.get('name_hi')),
        kind: kind as UlbKind,
      };
    }),
    ulbLinks: rows('village_ulb_map.csv').map((r) => {
      const e = r.get('merge_extent');
      if (e !== 'full' && e !== 'partial') errors.push(`village_ulb_map.csv:${r.line}: merge_extent must be full or partial`);
      return { line: r.line, village: r.get('village_lgd_code'), ulb: r.get('ulb_lgd_code'), extent: e as 'full' | 'partial' };
    }),
    zones: rows('zones.csv').map((r) => {
      const url = r.get('source_url');
      const asOf = r.get('as_of');
      if (!/^https:\/\//.test(url)) errors.push(`zones.csv:${r.line}: source_url must be an https URL (official Nagar Nigam source, D-06 Q6)`);
      if (!validDate(asOf) || asOf > today) errors.push(`zones.csv:${r.line}: as_of must be a real past date YYYY-MM-DD`);
      if (!r.get('zone_key')) errors.push(`zones.csv:${r.line}: zone_key is required`);
      return {
        line: r.line,
        key: r.get('zone_key'),
        ulb: r.get('ulb_lgd_code'),
        name_en: named('zones.csv', r.line, r.get('name_en')),
        name_hi: opt(r.get('name_hi')),
        source_url: url,
        as_of: asOf,
      };
    }),
    wards: rows('wards.csv').map((r) => ({
      line: r.line,
      lgd_code: code('wards.csv', r.line, 'lgd_code', r.get('lgd_code')),
      ulb: r.get('ulb_lgd_code'),
      name_en: named('wards.csv', r.line, r.get('name_en')),
      name_hi: opt(r.get('name_hi')),
      zone: opt(r.get('zone_key')),
    })),
    coords: rows('village_coords.csv').map((r) => {
      const lat = Number(r.get('lat'));
      const lng = Number(r.get('lng'));
      if (!DIGITS.test(r.get('pc11_code'))) errors.push(`village_coords.csv:${r.line}: pc11_code must be numeric`);
      if (r.get('lat') === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) errors.push(`village_coords.csv:${r.line}: lat is invalid`);
      if (r.get('lng') === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) errors.push(`village_coords.csv:${r.line}: lng is invalid`);
      return { line: r.line, pc11: r.get('pc11_code'), lat, lng };
    }),
  };

  errors.push(...validateRelations(ds));
  if (errors.length) throw new DatasetError(errors);
  return ds;
}

function uniqueBy<T extends { line: number }>(file: string, items: T[], key: (t: T) => string, label: string): string[] {
  const seen = new Map<string, number>();
  const errs: string[] = [];
  for (const it of items) {
    const k = key(it);
    const first = seen.get(k);
    if (first !== undefined) errs.push(`${file}:${it.line}: duplicate ${label} "${k}" (first on line ${first})`);
    else seen.set(k, it.line);
  }
  return errs;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Cross-file checks: exact district coverage, parents present and consistent, uniqueness. */
export function validateRelations(ds: Dataset, expected: readonly string[] = TARGET_DISTRICTS): string[] {
  const e: string[] = [];
  e.push(...uniqueBy('districts.csv', ds.districts, (d) => d.lgd_code, 'lgd_code'));
  e.push(...uniqueBy('blocks.csv', ds.blocks, (d) => d.lgd_code, 'lgd_code'));
  e.push(...uniqueBy('villages.csv', ds.villages, (d) => d.lgd_code, 'lgd_code'));
  e.push(...uniqueBy('gram_panchayats.csv', ds.gps, (d) => d.lgd_code, 'lgd_code'));
  e.push(...uniqueBy('village_gp_map.csv', ds.gpLinks, (d) => `${d.village}/${d.gp}`, 'village/gp pair'));
  e.push(...uniqueBy('ulbs.csv', ds.ulbs, (d) => d.lgd_code, 'lgd_code'));
  e.push(...uniqueBy('village_ulb_map.csv', ds.ulbLinks, (d) => d.village, 'village (one ULB per village)'));
  e.push(...uniqueBy('zones.csv', ds.zones, (d) => d.key, 'zone_key'));
  e.push(...uniqueBy('zones.csv', ds.zones, (d) => `${d.ulb}/${norm(d.name_en)}`, 'zone name within its ULB'));
  e.push(...uniqueBy('wards.csv', ds.wards, (d) => d.lgd_code, 'lgd_code'));
  e.push(...uniqueBy('village_coords.csv', ds.coords, (d) => d.pc11, 'pc11_code'));

  // Exactly the five pilot districts (by English name), no more, no fewer.
  const want = new Set(expected.map(norm));
  const got = ds.districts.map((d) => norm(d.name_en));
  const missing = expected.filter((n) => !got.includes(norm(n)));
  const unexpected = ds.districts.filter((d) => !want.has(norm(d.name_en)));
  if (missing.length) e.push(`districts.csv: missing pilot district(s): ${missing.join(', ')}`);
  for (const d of unexpected) e.push(`districts.csv:${d.line}: "${d.name_en}" is not one of the pilot districts (${expected.join(', ')})`);
  e.push(...uniqueBy('districts.csv', ds.districts, (d) => norm(d.name_en), 'district name'));

  const districts = new Set(ds.districts.map((d) => d.lgd_code));
  const blocks = new Map(ds.blocks.map((b) => [b.lgd_code, b]));
  const villages = new Set(ds.villages.map((v) => v.lgd_code));
  const gps = new Set(ds.gps.map((g) => g.lgd_code));
  const ulbs = new Map(ds.ulbs.map((u) => [u.lgd_code, u]));
  const zones = new Map(ds.zones.map((z) => [z.key, z]));

  for (const b of ds.blocks) if (!districts.has(b.district)) e.push(`blocks.csv:${b.line}: district_lgd_code "${b.district}" not in districts.csv`);
  for (const v of ds.villages) {
    if (!districts.has(v.district)) e.push(`villages.csv:${v.line}: district_lgd_code "${v.district}" not in districts.csv`);
    const b = blocks.get(v.block);
    if (!b) e.push(`villages.csv:${v.line}: block_lgd_code "${v.block}" not in blocks.csv`);
    else if (b.district !== v.district) {
      e.push(`villages.csv:${v.line}: block "${v.block}" belongs to district "${b.district}", not "${v.district}"`);
    }
  }
  for (const g of ds.gps) if (!blocks.has(g.block)) e.push(`gram_panchayats.csv:${g.line}: block_lgd_code "${g.block}" not in blocks.csv`);
  for (const l of ds.gpLinks) {
    if (!villages.has(l.village)) e.push(`village_gp_map.csv:${l.line}: village_lgd_code "${l.village}" not in villages.csv`);
    if (!gps.has(l.gp)) e.push(`village_gp_map.csv:${l.line}: gp_lgd_code "${l.gp}" not in gram_panchayats.csv`);
  }
  for (const u of ds.ulbs) if (!districts.has(u.district)) e.push(`ulbs.csv:${u.line}: district_lgd_code "${u.district}" not in districts.csv`);
  if (ds.present.includes('ulbs.csv')) {
    for (const d of ds.districts) {
      const n = ds.ulbs.filter((u) => u.district === d.lgd_code && u.kind === 'nagar_nigam').length;
      if (n !== 1) e.push(`ulbs.csv: district "${d.name_en}" must have exactly one nagar_nigam row, found ${n}`);
    }
  }
  for (const l of ds.ulbLinks) {
    if (!villages.has(l.village)) e.push(`village_ulb_map.csv:${l.line}: village_lgd_code "${l.village}" not in villages.csv`);
    if (!ulbs.has(l.ulb)) e.push(`village_ulb_map.csv:${l.line}: ulb_lgd_code "${l.ulb}" not in ulbs.csv`);
  }
  for (const z of ds.zones) {
    const u = ulbs.get(z.ulb);
    if (!u) e.push(`zones.csv:${z.line}: ulb_lgd_code "${z.ulb}" not in ulbs.csv`);
    else if (u.kind !== 'nagar_nigam') e.push(`zones.csv:${z.line}: zones are only for Nagar Nigams; "${z.ulb}" is ${u.kind}`);
  }
  for (const w of ds.wards) {
    const u = ulbs.get(w.ulb);
    if (!u) e.push(`wards.csv:${w.line}: ulb_lgd_code "${w.ulb}" not in ulbs.csv`);
    else if (u.kind !== 'nagar_nigam') e.push(`wards.csv:${w.line}: wards are only loaded for Nagar Nigams; "${w.ulb}" is ${u.kind}`);
    if (w.zone !== null) {
      const z = zones.get(w.zone);
      if (!z) e.push(`wards.csv:${w.line}: zone_key "${w.zone}" not in zones.csv`);
      else if (z.ulb !== w.ulb) e.push(`wards.csv:${w.line}: zone "${w.zone}" belongs to ULB "${z.ulb}", not "${w.ulb}"`);
    }
  }
  return e;
}

/** All LGD codes in the dataset (used by the real seed command to refuse fixture data). */
export function allCodes(ds: Dataset): string[] {
  return [
    ...ds.districts.map((d) => d.lgd_code),
    ...ds.blocks.map((d) => d.lgd_code),
    ...ds.villages.map((d) => d.lgd_code),
    ...ds.gps.map((d) => d.lgd_code),
    ...ds.ulbs.map((d) => d.lgd_code),
    ...ds.wards.map((d) => d.lgd_code),
  ];
}
