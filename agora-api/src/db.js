const { Pool } = require("pg");
const config = require("./config");
const { getCurrentSchoolId } = require("./utils/request-context");

const rawPool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
});

async function applyTenantContext(client) {
  const schoolId = getCurrentSchoolId();
  const tenantValue = schoolId || "";
  await client.query("SELECT set_config('app.current_school_id', $1, false)", [tenantValue]);
}

async function query(text, params) {
  const client = await rawPool.connect();
  try {
    await applyTenantContext(client);
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function connect() {
  const client = await rawPool.connect();
  await applyTenantContext(client);
  return client;
}

async function end() {
  return rawPool.end();
}

module.exports = {
  query,
  connect,
  end,
  rawPool,
};
