/**
 * Database persistence layer for PostgreSQL.
 * Provides a connection pool, a convenient query helper, and a graceful shutdown.
 */

import { Pool } from 'pg';

// Configuration is taken from environment variables. This mirrors the defaults used by pg.
//   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSL, etc.
// If a full connection string is supplied via DATABASE_URL it will be used instead.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // When DATABASE_URL is not set, pg will fall back to the individual env vars.
  // Additional pool options can be tuned here if needed.
  // Example: max: 20,
});

/**
 * Execute a SQL query using the shared pool.
 *
 * @param {string} text - The SQL query text.
 * @param {Array<any>} [params] - Optional array of parameters for parameterized queries.
 * @returns {Promise<import('pg').QueryResult<any>>} Resolves with the query result.
 */
export async function query(text, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Gracefully close the connection pool. Useful for test teardown or application shutdown.
 *
 * @returns {Promise<void>}
 */
export async function closePool() {
  await pool.end();
}

export { pool };
