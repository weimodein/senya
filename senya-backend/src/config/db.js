const fs = require("fs");
const path = require("path");
const { Sequelize } = require("sequelize");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

// Tests set DB_SCHEMA so they run in their own schema and never touch real data.
const schema = process.env.DB_SCHEMA || "public";
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`invalid DB_SCHEMA: ${schema}`);
const isLocal = /localhost|127\.0\.0\.1/.test(url);

const sequelize = new Sequelize(url, {
  dialect: "postgres",
  logging: false,
  // Supabase requires TLS; its pooler certificate isn't in Node's default store.
  dialectOptions: isLocal ? {} : { ssl: { require: true, rejectUnauthorized: false } },
  pool: { max: 5, idle: 10000 },
  hooks:
    schema === "public"
      ? {}
      : {
          afterConnect: (connection) =>
            connection.query(`CREATE SCHEMA IF NOT EXISTS ${schema}; SET search_path TO ${schema}`),
        },
});

/** Runs every migrations/*.sql file in name order. Each one is idempotent (IF NOT EXISTS). */
async function migrate() {
  const dir = path.join(__dirname, "..", "..", "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await sequelize.query(fs.readFileSync(path.join(dir, file), "utf8"));
  }
}

module.exports = { sequelize, migrate, schema };
