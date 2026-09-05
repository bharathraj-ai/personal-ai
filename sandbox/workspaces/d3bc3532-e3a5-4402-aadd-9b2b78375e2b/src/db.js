require('dotenv').config();

const { Pool } = require('pg');

// Create a connection pool using environment variables.
// Expected variables: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : undefined,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  // Optional: configure pool size, idle timeout, etc.
});

/**
 * Execute a SQL query using the pool.
 * @param {string} text - The query text.
 * @param {Array<any>} [params] - Optional query parameters.
 * @returns {Promise<import('pg').QueryResult>} The query result.
 */
async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

/**
 * Obtain a dedicated client from the pool for transaction handling.
 * Caller is responsible for releasing the client via client.release().
 * @returns {Promise<import('pg').PoolClient>} A connected client.
 */
async function getClient() {
  return pool.connect();
}

/**
 * Gracefully shut down the pool and close all connections.
 * @returns {Promise<void>}
 */
async function close() {
  await pool.end();
}

module.exports = {
  query,
  getClient,
  close,
};