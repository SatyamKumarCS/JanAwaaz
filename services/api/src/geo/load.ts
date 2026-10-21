// Loads a validated geography dataset (I-03) in one transaction. Rows are upserted by LGD code, so
// reruns are idempotent and a renamed ward keeps its row. Derived fields (coordinates, merged-ULB
// links, village↔GP links, ward zones) are recomputed from the dataset on every run. Nothing is
// deleted: rows in the database that the dataset no longer lists are reported, never removed,
// because complaints may reference them. Any failure rolls the whole load back.
import type { Dataset } from './dataset';
import { TARGET_DISTRICTS } from './dataset';

/** The subset of a Prisma transaction client used here. */
export interface Sql {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}
export interface TxRunner {
  $transaction<T>(fn: (tx: Sql) => Promise<T>, opts?: { timeout?: number; maxWait?: number }): Promise<T>;
}

export class SeedIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedIntegrityError';
  }
}

const CHUNK = 2000;
function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}
const col = <T, K extends keyof T>(rows: T[], k: K) => rows.map((r) => r[k]);

export interface SeedReport {
  dataset: string;
  sources: Dataset['manifest']['files'];
  districts: {
    lgd_code: string;
    name: string;
    blocks: number;
    villages: number;
    villages_missing_hi: number;
    villages_with_coords: number;
    villages_without_coords: number;
    villages_merged_full: number;
    villages_merged_partial: number;
    gram_panchayats: number;
    ulbs: Record<string, number>;
  }[];
  cities: { ulb_lgd_code: string; name: string; wards: number; wards_with_zone: number; wards_without_zone: string[]; zones: number }[];
  coords: { file_rows: number; matched_rows: number; unmatched_rows: number; licence: string | null };
  not_in_dataset: { districts: number; blocks: number; villages: number; gram_panchayats: number; ulbs: number; wards: number };
}

export async function loadDataset(db: TxRunner, ds: Dataset): Promise<SeedReport> {
  return db.$transaction(
    async (tx) => {
      await upsertAll(tx, ds);
      await checkIntegrity(tx);
      return buildReport(tx, ds);
    },
    { timeout: 300_000, maxWait: 10_000 },
  );
}

async function upsertAll(tx: Sql, ds: Dataset) {
  for (const c of chunks(ds.districts)) {
    await tx.$executeRaw`
      INSERT INTO districts (lgd_code, name, name_hi)
      SELECT * FROM unnest(${col(c, 'lgd_code')}::text[], ${col(c, 'name_en')}::text[], ${col(c, 'name_hi')}::text[])
      ON CONFLICT (lgd_code) DO UPDATE SET name = EXCLUDED.name, name_hi = EXCLUDED.name_hi`;
  }
  for (const c of chunks(ds.blocks)) {
    await tx.$executeRaw`
      INSERT INTO blocks (district_id, lgd_code, name, name_hi)
      SELECT d.id, x.code, x.name, x.hi
      FROM unnest(${col(c, 'lgd_code')}::text[], ${col(c, 'district')}::text[], ${col(c, 'name_en')}::text[], ${col(c, 'name_hi')}::text[])
        AS x(code, dcode, name, hi)
      JOIN districts d ON d.lgd_code = x.dcode
      ON CONFLICT (lgd_code) DO UPDATE SET district_id = EXCLUDED.district_id, name = EXCLUDED.name, name_hi = EXCLUDED.name_hi`;
  }
  for (const c of chunks(ds.ulbs)) {
    await tx.$executeRaw`
      INSERT INTO ulbs (lgd_code, district_id, name_en, name_hi, kind, supported)
      SELECT x.code, d.id, x.name, x.hi, x.kind::ulb_kind, x.kind = 'nagar_nigam'
      FROM unnest(${col(c, 'lgd_code')}::text[], ${col(c, 'district')}::text[], ${col(c, 'name_en')}::text[], ${col(c, 'name_hi')}::text[], ${col(c, 'kind')}::text[])
        AS x(code, dcode, name, hi, kind)
      JOIN districts d ON d.lgd_code = x.dcode
      ON CONFLICT (lgd_code) DO UPDATE SET district_id = EXCLUDED.district_id, name_en = EXCLUDED.name_en,
        name_hi = EXCLUDED.name_hi, kind = EXCLUDED.kind, supported = EXCLUDED.supported`;
  }

  // Villages: coordinates joined by Census 2011 code; merged-ULB link from the LGD urban-village report.
  const coord = new Map(ds.coords.map((c) => [c.pc11, c]));
  const merged = new Map(ds.ulbLinks.map((l) => [l.village, l]));
  const villages = ds.villages.map((v) => {
    const c = v.pc11 ? coord.get(v.pc11) : undefined;
    const m = merged.get(v.lgd_code);
    return { ...v, lat: c?.lat ?? null, lng: c?.lng ?? null, ulb: m?.ulb ?? null, extent: m?.extent ?? null };
  });
  for (const c of chunks(villages)) {
    await tx.$executeRaw`
      INSERT INTO villages (district_id, block_id, lgd_code, name, name_hi, area_type, pc11_code, lat, lng, coord_source, merged_ulb_id, merge_extent)
      SELECT d.id, b.id, x.code, x.name, x.hi, 'rural'::area_type, x.pc11, x.lat, x.lng,
        CASE WHEN x.lat IS NULL THEN NULL ELSE 'shrug_pc11'::coord_source END,
        u.id, x.extent::merge_extent
      FROM unnest(${col(c, 'lgd_code')}::text[], ${col(c, 'district')}::text[], ${col(c, 'block')}::text[],
                  ${col(c, 'name_en')}::text[], ${col(c, 'name_hi')}::text[], ${col(c, 'pc11')}::text[],
                  ${col(c, 'lat')}::float8[], ${col(c, 'lng')}::float8[], ${col(c, 'ulb')}::text[], ${col(c, 'extent')}::text[])
        AS x(code, dcode, bcode, name, hi, pc11, lat, lng, ucode, extent)
      JOIN districts d ON d.lgd_code = x.dcode
      JOIN blocks b ON b.lgd_code = x.bcode
      LEFT JOIN ulbs u ON u.lgd_code = x.ucode
      ON CONFLICT (lgd_code) DO UPDATE SET district_id = EXCLUDED.district_id, block_id = EXCLUDED.block_id,
        name = EXCLUDED.name, name_hi = EXCLUDED.name_hi, area_type = EXCLUDED.area_type, pc11_code = EXCLUDED.pc11_code,
        lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
        merged_ulb_id = EXCLUDED.merged_ulb_id, merge_extent = EXCLUDED.merge_extent`;
  }

  for (const c of chunks(ds.gps)) {
    await tx.$executeRaw`
      INSERT INTO gram_panchayats (lgd_code, name_en, name_hi, block_id)
      SELECT x.code, x.name, x.hi, b.id
      FROM unnest(${col(c, 'lgd_code')}::text[], ${col(c, 'block')}::text[], ${col(c, 'name_en')}::text[], ${col(c, 'name_hi')}::text[])
        AS x(code, bcode, name, hi)
      JOIN blocks b ON b.lgd_code = x.bcode
      ON CONFLICT (lgd_code) DO UPDATE SET name_en = EXCLUDED.name_en, name_hi = EXCLUDED.name_hi, block_id = EXCLUDED.block_id`;
  }
  // village↔GP links are derived data: replace them for the dataset's villages.
  for (const c of chunks(ds.villages)) {
    await tx.$executeRaw`
      DELETE FROM village_gp_map m USING villages v
      WHERE m.village_id = v.id AND v.lgd_code = ANY(${col(c, 'lgd_code')}::text[])`;
  }
  for (const c of chunks(ds.gpLinks)) {
    await tx.$executeRaw`
      INSERT INTO village_gp_map (village_id, gp_id, is_full)
      SELECT v.id, g.id, x.is_full
      FROM unnest(${col(c, 'village')}::text[], ${col(c, 'gp')}::text[], ${col(c, 'is_full')}::bool[]) AS x(vcode, gcode, is_full)
      JOIN villages v ON v.lgd_code = x.vcode
      JOIN gram_panchayats g ON g.lgd_code = x.gcode`;
  }

  // Zones have no LGD code; they are matched by (ULB, English name) within the ULB.
  const zoneIds = new Map<string, number>();
  for (const z of ds.zones) {
    const rows = await tx.$queryRaw<{ id: number }[]>`
      WITH u AS (SELECT id FROM ulbs WHERE lgd_code = ${z.ulb}::text),
      upd AS (
        UPDATE zones SET name_en = ${z.name_en}::text, name_hi = ${z.name_hi}::text, source_url = ${z.source_url}::text, as_of = ${z.as_of}::date
        WHERE ulb_id = (SELECT id FROM u) AND lower(name_en) = lower(${z.name_en}::text)
        RETURNING id
      ),
      ins AS (
        INSERT INTO zones (ulb_id, name_en, name_hi, source_url, as_of)
        SELECT (SELECT id FROM u), ${z.name_en}::text, ${z.name_hi}::text, ${z.source_url}::text, ${z.as_of}::date
        WHERE NOT EXISTS (SELECT 1 FROM upd)
        RETURNING id
      )
      SELECT id FROM upd UNION ALL SELECT id FROM ins`;
    zoneIds.set(z.key, rows[0]!.id);
  }
  const wardsAsOf = ds.manifest.files['wards.csv']?.as_of ?? null;
  const wards = ds.wards.map((w) => ({ ...w, zone_id: w.zone ? zoneIds.get(w.zone)! : null }));
  for (const c of chunks(wards)) {
    await tx.$executeRaw`
      INSERT INTO wards (ulb_id, lgd_code, name_en, name_hi, as_of, zone_id)
      SELECT u.id, x.code, x.name, x.hi, ${wardsAsOf}::date, x.zone
      FROM unnest(${col(c, 'lgd_code')}::text[], ${col(c, 'ulb')}::text[], ${col(c, 'name_en')}::text[], ${col(c, 'name_hi')}::text[], ${col(c, 'zone_id')}::int[])
        AS x(code, ucode, name, hi, zone)
      JOIN ulbs u ON u.lgd_code = x.ucode
      ON CONFLICT (lgd_code) DO UPDATE SET ulb_id = EXCLUDED.ulb_id, name_en = EXCLUDED.name_en, name_hi = EXCLUDED.name_hi,
        as_of = EXCLUDED.as_of, zone_id = EXCLUDED.zone_id`;
  }

  // Every input row must have landed (an inner JOIN silently drops a row whose parent is missing).
  const [landed] = await tx.$queryRaw<Record<'districts' | 'blocks' | 'villages' | 'gps' | 'ulbs' | 'wards', bigint>[]>`
    SELECT
      (SELECT count(*) FROM districts WHERE lgd_code = ANY(${col(ds.districts, 'lgd_code')}::text[]))::bigint AS districts,
      (SELECT count(*) FROM blocks WHERE lgd_code = ANY(${col(ds.blocks, 'lgd_code')}::text[]))::bigint AS blocks,
      (SELECT count(*) FROM villages WHERE lgd_code = ANY(${col(ds.villages, 'lgd_code')}::text[]))::bigint AS villages,
      (SELECT count(*) FROM gram_panchayats WHERE lgd_code = ANY(${col(ds.gps, 'lgd_code')}::text[]))::bigint AS gps,
      (SELECT count(*) FROM ulbs WHERE lgd_code = ANY(${col(ds.ulbs, 'lgd_code')}::text[]))::bigint AS ulbs,
      (SELECT count(*) FROM wards WHERE lgd_code = ANY(${col(ds.wards, 'lgd_code')}::text[]))::bigint AS wards`;
  const expected = {
    districts: ds.districts.length, blocks: ds.blocks.length, villages: ds.villages.length,
    gps: ds.gps.length, ulbs: ds.ulbs.length, wards: ds.wards.length,
  };
  for (const [k, n] of Object.entries(expected)) {
    const got = Number(landed![k as keyof typeof expected]);
    if (got !== n) throw new SeedIntegrityError(`${k}: expected ${n} rows, wrote ${got} (rolled back)`);
  }
}

async function checkIntegrity(tx: Sql) {
  const [r] = await tx.$queryRaw<
    { districts: bigint; orphan_villages: bigint; mismatched_villages: bigint; orphan_blocks: bigint }[]
  >`
    SELECT
      (SELECT count(*) FROM districts)::bigint AS districts,
      (SELECT count(*) FROM villages v LEFT JOIN blocks b ON b.id = v.block_id LEFT JOIN districts d ON d.id = v.district_id
        WHERE b.id IS NULL OR d.id IS NULL)::bigint AS orphan_villages,
      (SELECT count(*) FROM villages v JOIN blocks b ON b.id = v.block_id WHERE b.district_id <> v.district_id)::bigint AS mismatched_villages,
      (SELECT count(*) FROM blocks b LEFT JOIN districts d ON d.id = b.district_id WHERE d.id IS NULL)::bigint AS orphan_blocks`;
  if (Number(r!.districts) !== TARGET_DISTRICTS.length) {
    throw new SeedIntegrityError(
      `database would hold ${r!.districts} districts; exactly ${TARGET_DISTRICTS.length} pilot districts are allowed (rolled back)`,
    );
  }
  for (const [k, v] of Object.entries(r!)) {
    if (k !== 'districts' && Number(v) !== 0) throw new SeedIntegrityError(`integrity check failed: ${k} = ${v} (rolled back)`);
  }
}

async function buildReport(tx: Sql, ds: Dataset): Promise<SeedReport> {
  const districts = await tx.$queryRaw<
    {
      lgd_code: string; name: string; blocks: bigint; villages: bigint; villages_missing_hi: bigint; with_coords: bigint;
      merged_full: bigint; merged_partial: bigint; gps: bigint;
    }[]
  >`
    SELECT d.lgd_code, d.name,
      (SELECT count(*) FROM blocks b WHERE b.district_id = d.id)::bigint AS blocks,
      (SELECT count(*) FROM villages v WHERE v.district_id = d.id)::bigint AS villages,
      (SELECT count(*) FROM villages v WHERE v.district_id = d.id AND v.name_hi IS NULL)::bigint AS villages_missing_hi,
      (SELECT count(*) FROM villages v WHERE v.district_id = d.id AND v.lat IS NOT NULL)::bigint AS with_coords,
      (SELECT count(*) FROM villages v WHERE v.district_id = d.id AND v.merge_extent = 'full')::bigint AS merged_full,
      (SELECT count(*) FROM villages v WHERE v.district_id = d.id AND v.merge_extent = 'partial')::bigint AS merged_partial,
      (SELECT count(*) FROM gram_panchayats g JOIN blocks b ON b.id = g.block_id WHERE b.district_id = d.id)::bigint AS gps
    FROM districts d ORDER BY d.lgd_code`;
  const ulbCounts = await tx.$queryRaw<{ lgd_code: string; kind: string; n: bigint }[]>`
    SELECT d.lgd_code, u.kind::text AS kind, count(*)::bigint AS n FROM ulbs u JOIN districts d ON d.id = u.district_id
    GROUP BY d.lgd_code, u.kind ORDER BY d.lgd_code, u.kind`;
  const cities = await tx.$queryRaw<{ ulb_lgd_code: string; name: string; wards: bigint; with_zone: bigint; zones: bigint; unmapped: string[] | null }[]>`
    SELECT u.lgd_code AS ulb_lgd_code, u.name_en AS name,
      (SELECT count(*) FROM wards w WHERE w.ulb_id = u.id)::bigint AS wards,
      (SELECT count(*) FROM wards w WHERE w.ulb_id = u.id AND w.zone_id IS NOT NULL)::bigint AS with_zone,
      (SELECT count(*) FROM zones z WHERE z.ulb_id = u.id)::bigint AS zones,
      (SELECT array_agg(w.lgd_code ORDER BY w.lgd_code) FROM wards w WHERE w.ulb_id = u.id AND w.zone_id IS NULL) AS unmapped
    FROM ulbs u WHERE u.kind = 'nagar_nigam' ORDER BY u.lgd_code`;
  const counts = await tx.$queryRaw<Record<'districts' | 'blocks' | 'villages' | 'gram_panchayats' | 'ulbs' | 'wards', bigint>[]>`
    SELECT
      (SELECT count(*) FROM districts WHERE NOT (lgd_code = ANY(${col(ds.districts, 'lgd_code')}::text[])))::bigint AS districts,
      (SELECT count(*) FROM blocks WHERE NOT (lgd_code = ANY(${col(ds.blocks, 'lgd_code')}::text[])))::bigint AS blocks,
      (SELECT count(*) FROM villages WHERE NOT (lgd_code = ANY(${col(ds.villages, 'lgd_code')}::text[])))::bigint AS villages,
      (SELECT count(*) FROM gram_panchayats WHERE NOT (lgd_code = ANY(${col(ds.gps, 'lgd_code')}::text[])))::bigint AS gram_panchayats,
      (SELECT count(*) FROM ulbs WHERE NOT (lgd_code = ANY(${col(ds.ulbs, 'lgd_code')}::text[])))::bigint AS ulbs,
      (SELECT count(*) FROM wards WHERE NOT (lgd_code = ANY(${col(ds.wards, 'lgd_code')}::text[])))::bigint AS wards`;

  const villagePc11 = new Set(ds.villages.map((v) => v.pc11).filter(Boolean));
  const matched = ds.coords.filter((c) => villagePc11.has(c.pc11)).length;
  const n = (v: bigint) => Number(v);
  return {
    dataset: ds.manifest.dataset,
    sources: ds.manifest.files,
    districts: districts.map((d) => ({
      lgd_code: d.lgd_code,
      name: d.name,
      blocks: n(d.blocks),
      villages: n(d.villages),
      villages_missing_hi: n(d.villages_missing_hi),
      villages_with_coords: n(d.with_coords),
      villages_without_coords: n(d.villages) - n(d.with_coords),
      villages_merged_full: n(d.merged_full),
      villages_merged_partial: n(d.merged_partial),
      gram_panchayats: n(d.gps),
      ulbs: Object.fromEntries(ulbCounts.filter((u) => u.lgd_code === d.lgd_code).map((u) => [u.kind, n(u.n)])),
    })),
    cities: cities.map((c) => ({
      ulb_lgd_code: c.ulb_lgd_code,
      name: c.name,
      wards: n(c.wards),
      wards_with_zone: n(c.with_zone),
      wards_without_zone: c.unmapped ?? [],
      zones: n(c.zones),
    })),
    coords: {
      file_rows: ds.coords.length,
      matched_rows: matched,
      unmatched_rows: ds.coords.length - matched,
      licence: ds.manifest.files['village_coords.csv']?.licence ?? null,
    },
    not_in_dataset: Object.fromEntries(Object.entries(counts[0]!).map(([k, v]) => [k, n(v)])) as SeedReport['not_in_dataset'],
  };
}

