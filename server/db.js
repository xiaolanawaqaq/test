"use strict";

const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is required");
  pool = new Pool({
    connectionString: url,
    max: 8,
    idleTimeoutMillis: 30000,
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
  });
  pool.on("error", (err) => {
    console.error("pg pool unexpected error:", err.message);
  });
  return pool;
}

async function query(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

async function ready() {
  try {
    await query("SELECT 1");
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { getPool, query, transaction, close, ready };
