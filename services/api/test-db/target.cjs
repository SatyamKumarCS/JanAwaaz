// Fail-closed target for the DB integration tests: a dedicated throwaway database on a local
// host only (D-18 Q9). Refuses anything else, so a cloud or production database is never touched.
const TEST_DB = 'janawaaz_i02_test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);

function targets() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set (run via `pnpm test:db`)');
  const admin = new URL(base);
  if (!LOCAL_HOSTS.has(admin.hostname)) {
    throw new Error(`refusing to run DB tests against non-local host "${admin.hostname}"`);
  }
  const test = new URL(base);
  test.pathname = `/${TEST_DB}`;
  test.search = '';
  return { adminUrl: admin.toString(), testUrl: test.toString(), testDb: TEST_DB };
}

module.exports = { targets, TEST_DB };
