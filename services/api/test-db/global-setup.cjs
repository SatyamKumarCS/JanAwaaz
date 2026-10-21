const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { Client } = require('pg');
const { targets } = require('./target.cjs');

module.exports = async () => {
  const { adminUrl, testUrl, testDb } = targets();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${testDb}"`);
  await admin.end();
  // Apply the committed migrations exactly as deploys do.
  const prisma = resolve(__dirname, '..', 'node_modules', '.bin', 'prisma');
  execFileSync(prisma, ['migrate', 'deploy'], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DIRECT_URL: testUrl, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
  process.env.I02_TEST_DATABASE_URL = testUrl;
};
