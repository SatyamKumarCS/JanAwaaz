// I-02 migration tests against a throwaway local PostgreSQL 18 + pgvector database.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { targets } = require('./target.cjs') as { targets: () => { testUrl: string } };

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: targets().testUrl });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

async function columns(table: string): Promise<Map<string, { nullable: boolean; udt: string }>> {
  const res = await db.query(
    `SELECT column_name, is_nullable, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Map(res.rows.map((r) => [r.column_name, { nullable: r.is_nullable === 'YES', udt: r.udt_name }]));
}

async function enumValues(type: string): Promise<string[]> {
  const res = await db.query(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1 ORDER BY e.enumsortorder`,
    [type],
  );
  return res.rows.map((r) => r.enumlabel);
}

async function expectColumns(table: string, names: string[]) {
  const cols = await columns(table);
  expect(cols.size).toBeGreaterThan(0);
  for (const n of names) expect({ table, column: n, present: cols.has(n) }).toEqual({ table, column: n, present: true });
}

/** Runs `sql` inside a savepoint and returns the Postgres error code (or null on success). */
async function tryInsert(sql: string, params: unknown[] = []): Promise<string | null> {
  await db.query('BEGIN');
  try {
    await db.query(sql, params);
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown';
  } finally {
    await db.query('ROLLBACK');
  }
}

// ---------- Fixture rows shared by the constraint tests ----------
type FixtureIds = Record<
  'district' | 'block' | 'village' | 'ulb' | 'ward' | 'dept' | 'office' | 'citizen' | 'staff' | 'complaint' | 'link',
  number
>;
let ids: FixtureIds;

beforeAll(async () => {
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0].id as number;
  const district = await one(`INSERT INTO districts (lgd_code, name) VALUES ('D1', 'Gorakhpur') RETURNING id`);
  const block = await one(`INSERT INTO blocks (district_id, lgd_code, name) VALUES ($1, 'B1', 'Block') RETURNING id`, [district]);
  const village = await one(
    `INSERT INTO villages (district_id, block_id, lgd_code, name, area_type) VALUES ($1, $2, 'V1', 'Village', 'rural') RETURNING id`,
    [district, block],
  );
  const ulb = await one(
    `INSERT INTO ulbs (lgd_code, district_id, name_en, kind, supported) VALUES ('U1', $1, 'Nagar Nigam', 'nagar_nigam', true) RETURNING id`,
    [district],
  );
  const ward = await one(
    `INSERT INTO wards (ulb_id, lgd_code, name_en, as_of) VALUES ($1, 'W1', 'Ward 1', '2026-10-01') RETURNING id`,
    [ulb],
  );
  const dept = await one(`INSERT INTO departments (name, category_map) VALUES ('Panchayati Raj', '{}') RETURNING id`);
  const office = await one(
    `INSERT INTO office_contacts (district_id, block_id, department_id, level, office_kind, office_name, source_url, last_verified_at)
     VALUES ($1, $2, $3, 2, 'bdo', 'BDO Block', 'https://example.test/src', now()) RETURNING id`,
    [district, block, dept],
  );
  const citizen = await one(`INSERT INTO citizens (token_hash) VALUES ('hash-1') RETURNING id`);
  const staff = await one(
    `INSERT INTO users (name, role, email, password_hash, office_id) VALUES ('Staff', 'staff', 's@example.test', 'x', $1) RETURNING id`,
    [office],
  );
  const complaint = await one(
    `INSERT INTO complaints (complaint_no, client_ref, citizen_id, village_id, area_type, category, updated_at)
     VALUES ('JAW-2026-000001', 'ref-1', $1, $2, 'rural', 'drainage', now()) RETURNING id`,
    [citizen, village],
  );
  const link = await one(
    `INSERT INTO status_links (token_hash, complaint_id, office_contact_id, expires_at)
     VALUES ('link-1', $1, $2, now() + interval '14 days') RETURNING id`,
    [complaint, office],
  );
  ids = { district, block, village, ulb, ward, dept, office, citizen, staff, complaint, link };
});

describe('migration artifacts', () => {
  test('the vector extension is created by a committed migration and is installed', async () => {
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const sql = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => readFileSync(join(dir, d.name, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector;/);
    const ext = await db.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
    expect(ext.rowCount).toBe(1);
    const emb = (await columns('complaints')).get('embedding');
    expect(emb?.udt).toBe('vector');
  });
});

describe('PRD §5.4 tables have every listed field', () => {
  test.each([
    ['districts', ['id', 'name']],
    ['blocks', ['id', 'name', 'district_id']],
    ['villages', ['id', 'name', 'district_id', 'block_id', 'area_type', 'lat', 'lng']],
    ['departments', ['id', 'name', 'category_map']],
    ['office_contacts', ['id', 'district_id', 'block_id', 'department_id', 'level', 'office_name', 'email', 'phone', 'whatsapp', 'source_url', 'last_verified_at']],
    ['complaints', ['id', 'complaint_no', 'village_id', 'category', 'description_en', 'description_hi', 'priority', 'department_id', 'status', 'image_url', 'lat', 'lng', 'ai_confidence', 'igrs_ref', 'created_at']],
    ['notifications', ['id', 'complaint_id', 'channel', 'status', 'sent_at', 'error']],
    ['status_history', ['id', 'complaint_id', 'old_status', 'new_status', 'remark', 'changed_at', 'actor_type', 'actor_user_id']],
    ['users', ['id', 'name', 'role', 'phone', 'email', 'department_id', 'district_id']],
    ['escalations', ['id', 'complaint_id', 'from_level', 'to_level', 'reason', 'created_at']],
  ])('%s', async (table, cols) => {
    await expectColumns(table, cols);
  });
});

describe('decision-driven tables and fields', () => {
  test('rural routing: gram_panchayats, village_gp_map, routing_gaps (D-05 Q1)', async () => {
    await expectColumns('gram_panchayats', ['id', 'lgd_code', 'name_en', 'name_hi', 'block_id']);
    await expectColumns('village_gp_map', ['village_id', 'gp_id', 'is_full']);
    await expectColumns('routing_gaps', ['id', 'complaint_id', 'level', 'missing', 'created_at', 'resolved_at']);
  });

  test('urban location: ulbs, wards, zones; complaints.ward_id nullable (D-06 Q1)', async () => {
    await expectColumns('ulbs', ['id', 'lgd_code', 'district_id', 'name_en', 'name_hi', 'kind', 'supported']);
    await expectColumns('wards', ['ulb_id', 'lgd_code', 'name_en', 'name_hi', 'as_of', 'zone_id']);
    await expectColumns('zones', ['id', 'ulb_id', 'name_en', 'name_hi', 'source_url', 'as_of']);
    expect((await columns('wards')).get('zone_id')?.nullable).toBe(true);
    expect((await columns('complaints')).get('ward_id')?.nullable).toBe(true);
    const dup = await tryInsert(`INSERT INTO wards (ulb_id, lgd_code, name_en, as_of) VALUES ($1, 'W1', 'Dup', '2026-10-01')`, [ids.ulb]);
    expect(dup).toBe('23505');
  });

  test('AI retry + vision fields (D-07 Q2, Q4)', async () => {
    await expectColumns('complaints', ['vision_mode', 'ai_pending_steps', 'ai_attempts', 'ai_next_attempt_at', 'ai_first_failed_at', 'ai_last_error']);
  });

  test('actor attribution columns and status_links forensics (D-11 Q2)', async () => {
    for (const t of ['status_history', 'audit_log']) {
      await expectColumns(t, ['actor_type', 'actor_user_id', 'actor_office_contact_id', 'status_link_id']);
    }
    await expectColumns('status_links', ['office_contact_id', 'revoked_at', 'revoke_reason', 'used_ip_hash', 'used_ua_summary', 'forensics_clear_at']);
    expect(await enumValues('actor_type')).toEqual(['staff', 'admin', 'system', 'citizen', 'office_link']);
  });

  test('tracking token hash only, no plaintext token columns (D-10 Q1, D-02 Q1)', async () => {
    await expectColumns('complaints', ['track_token_hash', 'track_token_rotated_at']);
    expect((await columns('complaints')).get('track_token_hash')?.nullable).toBe(true);
    for (const t of ['complaints', 'citizens', 'status_links']) {
      const cols = [...(await columns(t)).keys()];
      expect(cols.filter((c) => /token/.test(c) && !/token_hash|token_rotated_at|push_token/.test(c))).toEqual([]);
    }
  });

  test('remark visibility enum defaults to citizen (D-10 Q3)', async () => {
    expect(await enumValues('remark_visibility')).toEqual(['citizen', 'internal']);
    await db.query(
      `INSERT INTO status_history (complaint_id, new_status, actor_type) VALUES ($1, 'submitted', 'system')`,
      [ids.complaint],
    );
    const r = await db.query(`SELECT remark_visibility FROM status_history WHERE complaint_id = $1`, [ids.complaint]);
    expect(r.rows[0].remark_visibility).toBe('citizen');
  });

  test('office kinds, level 1–3, users.office_id, complaint office fields (D-05 Q4, Q6, Q8)', async () => {
    expect(await enumValues('office_kind')).toEqual([
      'gram_panchayat', 'bdo', 'nagar_nigam_zone', 'municipal_commissioner', 'dept_division', 'dept_circle', 'dm_igrs',
    ]);
    await expectColumns('users', ['office_id']);
    expect((await columns('users')).get('office_id')?.nullable).toBe(true);
    await expectColumns('complaints', ['office_contact_id', 'escalation_level']);
    expect(await enumValues('category')).toEqual(['roads', 'sanitation', 'streetlights', 'water_supply', 'drainage']);
    for (const level of [0, 4]) {
      const code = await tryInsert(
        `INSERT INTO office_contacts (district_id, department_id, level, office_kind, office_name, source_url, last_verified_at)
         VALUES ($1, $2, $3, 'bdo', 'x', 'https://example.test', now())`,
        [ids.district, ids.dept, level],
      );
      expect({ level, code }).toEqual({ level, code: '23514' });
    }
  });

  test('status enum has no closed; closure fields and event enum (D-04 Q1, Q5)', async () => {
    const status = await enumValues('complaint_status');
    expect(status).toEqual(['submitted', 'verified', 'routed', 'assigned', 'in_progress', 'resolved', 'rejected', 'escalated']);
    await expectColumns('complaints', ['closed_at', 'closure_reason']);
    expect(await enumValues('closure_reason')).toEqual(['citizen_confirmed', 'confirmation_timeout']);
    expect(await enumValues('status_history_event')).toEqual(['status_change', 're_routed', 'closed', 'escalated']);
  });

  test('citizens table, complaints.citizen_id FK, no citizen role (D-02 Q1)', async () => {
    await expectColumns('citizens', ['id', 'token_hash', 'push_token', 'created_at', 'last_seen_at']);
    expect(await enumValues('user_role')).toEqual(['staff', 'admin']);
    const fk = await db.query(
      `SELECT 1 FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'complaints' AND tc.constraint_type = 'FOREIGN KEY' AND k.column_name = 'citizen_id'`,
    );
    expect(fk.rowCount).toBe(1);
    expect(await tryInsert(`INSERT INTO citizens (token_hash) VALUES ('hash-1')`)).toBe('23505');
  });
});

describe('constraints', () => {
  const insertComplaint = (no: string, ref: string, village: number | null, ward: number | null) =>
    tryInsert(
      `INSERT INTO complaints (complaint_no, client_ref, citizen_id, village_id, ward_id, area_type, category, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'rural', 'roads', now())`,
      [no, ref, ids.citizen, village, ward],
    );

  test('exactly one of village_id / ward_id (D-06 Q1)', async () => {
    expect(await insertComplaint('JAW-2026-000101', 'r-101', null, null)).toBe('23514');
    expect(await insertComplaint('JAW-2026-000102', 'r-102', ids.village, ids.ward)).toBe('23514');
    expect(await insertComplaint('JAW-2026-000103', 'r-103', ids.village, null)).toBeNull();
    expect(await insertComplaint('JAW-2026-000104', 'r-104', null, ids.ward)).toBeNull();
  });

  test('complaint_no and client_ref are unique', async () => {
    expect(await insertComplaint('JAW-2026-000001', 'r-new', ids.village, null)).toBe('23505');
    expect(await insertComplaint('JAW-2026-000105', 'ref-1', ids.village, null)).toBe('23505');
  });

  test('complaint_no format JAW-<YYYY>-<6+ digits> (D-15 Q1)', async () => {
    expect(await insertComplaint('JAW-26-1', 'r-106', ids.village, null)).toBe('23514');
    expect(await insertComplaint('JAW-2026-1234567', 'r-107', ids.village, null)).toBeNull();
  });

  test('status_history actor attribution (D-11 Q2)', async () => {
    const ins = (actor: string, user: number | null, office: number | null, link: number | null) =>
      tryInsert(
        `INSERT INTO status_history (complaint_id, new_status, actor_type, actor_user_id, actor_office_contact_id, status_link_id)
         VALUES ($1, 'assigned', $2, $3, $4, $5)`,
        [ids.complaint, actor, user, office, link],
      );
    expect(await ins('staff', null, null, null)).toBe('23514');
    expect(await ins('admin', null, null, null)).toBe('23514');
    expect(await ins('office_link', null, ids.office, null)).toBe('23514');
    expect(await ins('office_link', null, null, ids.link)).toBe('23514');
    expect(await ins('staff', ids.staff, null, null)).toBeNull();
    expect(await ins('office_link', null, ids.office, ids.link)).toBeNull();
    expect(await ins('system', null, null, null)).toBeNull();
  });

  test('audit_log actor attribution (D-11 Q2)', async () => {
    const ins = (actor: string, user: number | null) =>
      tryInsert(`INSERT INTO audit_log (actor_type, actor_user_id, action, entity) VALUES ($1, $2, 'x', 'y')`, [actor, user]);
    expect(await ins('admin', null)).toBe('23514');
    expect(await ins('admin', ids.staff)).toBeNull();
  });

  test('one live status link per (complaint, office) (D-11 Q1)', async () => {
    const second = await tryInsert(
      `INSERT INTO status_links (token_hash, complaint_id, office_contact_id, expires_at) VALUES ('link-2', $1, $2, now())`,
      [ids.complaint, ids.office],
    );
    expect(second).toBe('23505');
  });
});
