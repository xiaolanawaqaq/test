"use strict";

const fs = require("fs");
const path = require("path");
const db = require("./db");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function run() {
  const client = db.getPool();
  await client.query("SELECT 1");
  await ensureMigrationsTable(client);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();

  const { rows: applied } = await client.query("SELECT name FROM _migrations");
  const appliedSet = new Set(applied.map(r => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    console.log(`Applying migration: ${file}`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
  }

  console.log("Migrations complete.");
}

async function close() {
  await db.close();
}

if (require.main === module) {
  run().then(() => close()).catch(e => { console.error(e); close(); process.exit(1); });
}

module.exports = { run };
