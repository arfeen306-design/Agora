const test = require("node:test");
const assert = require("node:assert/strict");

const configPath = require.resolve("../src/config");

function reloadConfig() {
  delete require.cache[configPath];
  return require(configPath);
}

function withEnv(overrides, fn) {
  const touchedKeys = Object.keys(overrides);
  const previous = {};

  for (const key of touchedKeys) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    return fn();
  } finally {
    for (const key of touchedKeys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
    delete require.cache[configPath];
  }
}

test("DB_CREDENTIALS_SECRET_JSON overrides DB connection fields", () => {
  const secret = JSON.stringify({
    host: "rds.example.internal",
    port: 6432,
    dbname: "agora_prod",
    username: "agora_app",
    password: "super-secret",
    sslmode: "require",
  });

  withEnv(
    {
      DB_HOST: "127.0.0.1",
      DB_PORT: "5432",
      DB_NAME: "agora",
      DB_USER: "agora_user",
      DB_PASSWORD: "local",
      DB_SSL: "false",
      DB_CREDENTIALS_SECRET_JSON: secret,
      DB_CREDENTIALS_SECRET_BASE64: undefined,
    },
    () => {
      const config = reloadConfig();
      assert.equal(config.db.host, "rds.example.internal");
      assert.equal(config.db.port, 6432);
      assert.equal(config.db.database, "agora_prod");
      assert.equal(config.db.user, "agora_app");
      assert.equal(config.db.password, "super-secret");
      assert.equal(config.db.ssl, true);
      assert.equal(config.db.secretSource, "DB_CREDENTIALS_SECRET_JSON");
    }
  );
});

test("DB_CREDENTIALS_SECRET_BASE64 is accepted", () => {
  const secretB64 = Buffer.from(
    JSON.stringify({
      host: "rds-base64.example.internal",
      port: 5432,
      database: "agora_base64",
      user: "agora_base64_user",
      password: "base64-secret",
      ssl: true,
    }),
    "utf8"
  ).toString("base64");

  withEnv(
    {
      DB_CREDENTIALS_SECRET_JSON: undefined,
      DB_CREDENTIALS_SECRET_BASE64: secretB64,
    },
    () => {
      const config = reloadConfig();
      assert.equal(config.db.host, "rds-base64.example.internal");
      assert.equal(config.db.database, "agora_base64");
      assert.equal(config.db.user, "agora_base64_user");
      assert.equal(config.db.password, "base64-secret");
      assert.equal(config.db.ssl, true);
      assert.equal(config.db.secretSource, "DB_CREDENTIALS_SECRET_BASE64");
    }
  );
});

test("invalid DB_CREDENTIALS_SECRET_JSON fails fast", () => {
  withEnv(
    {
      DB_CREDENTIALS_SECRET_JSON: "{not-json",
      DB_CREDENTIALS_SECRET_BASE64: undefined,
    },
    () => {
      assert.throws(() => reloadConfig(), /DB_CREDENTIALS_SECRET_JSON is invalid/);
    }
  );
});
