const { Client } = require('pg');
const { targets } = require('./target.cjs');

module.exports = async () => {
  const { adminUrl, testDb } = targets();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
  await admin.end();
};
