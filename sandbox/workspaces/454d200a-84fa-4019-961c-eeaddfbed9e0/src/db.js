import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool;
let migrated = false;

export function getDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || "";
}

export function getPool() {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error("DATABASE_UNAVAILABLE: DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      ssl: /neon\.tech|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function migrate() {
  if (migrated) return;
  const sql = fs.readFileSync(path.join(__dirname, "../schema/schema.sql"), "utf8");
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(87236401)");
    await client.query("CREATE SCHEMA IF NOT EXISTS school_app");
    await client.query(sql);
    migrated = true;
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(87236401)");
    } catch {
      /* ignore */
    }
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
    migrated = false;
  }
}

export function publicRow(row) {
  if (!row) return row;
  const { password_hash, ...rest } = row;
  return rest;
}
