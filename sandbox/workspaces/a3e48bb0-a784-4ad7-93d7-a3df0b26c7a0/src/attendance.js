/**
 * Attendance module
 * Provides functions to retrieve and record attendance for a user.
 *
 * Dependencies:
 *   - pg: PostgreSQL client
 *   - ./auth.js: authentication utilities (expects a `verifyToken(token)` function that returns a user id)
 */

import { Pool } from 'pg';
import { verifyToken } from './auth.js';

// Create a single shared pool instance. Connection details are taken from
// environment variables (PGHOST, PGUSER, PGDATABASE, PGPASSWORD, PGPORT).
const pool = new Pool();

/**
 * Retrieve attendance records for a given user.
 *
 * @param {string|number} userId - The identifier of the user whose attendance is requested.
 * @returns {Promise<Array<{id:number, user_id:number, status:string, timestamp:Date}>>}
 *          Resolves with an array of attendance rows.
 */
export async function getAttendance(userId) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, user_id, status, timestamp
       FROM attendance
       WHERE user_id = $1
       ORDER BY timestamp DESC`,
      [userId]
    );
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * Record a new attendance entry for a user.
 *
 * @param {string} token - Authentication token (e.g., JWT). The token is verified to obtain the user id.
 * @param {string} status - Attendance status (e.g., 'present', 'absent', 'late').
 * @returns {Promise<{id:number, user_id:number, status:string, timestamp:Date}>}
 *          Resolves with the inserted attendance row.
 */
export async function markAttendance(token, status) {
  // Verify token to obtain the user identifier.
  const userId = await verifyToken(token);
  if (!userId) {
    throw new Error('Invalid authentication token');
  }

  const client = await pool.connect();
  try {
    const now = new Date();
    const insertQuery = `
      INSERT INTO attendance (user_id, status, timestamp)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, status, timestamp`;
    const res = await client.query(insertQuery, [userId, status, now]);
    return res.rows[0];
  } finally {
    client.release();
  }
}

// Export the pool for potential external use (e.g., graceful shutdown).
export { pool };
