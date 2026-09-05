const { Pool } = require('pg');

// Initialise a single connection pool. Connection details are taken from the standard DATABASE_URL environment variable.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Retrieve the list of role names assigned to a given user.
 * @param {number|string} userId - The identifier of the user.
 * @returns {Promise<string[]>} - Array of role names.
 */
async function getUserRoles(userId) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [userId]
    );
    return res.rows.map(row => row.name);
  } finally {
    client.release();
  }
}

/**
 * Determine whether a user possesses a specific permission.
 * @param {number|string} userId - The identifier of the user.
 * @param {string} permission - Permission string to check.
 * @returns {Promise<boolean>} - True if the user has the permission.
 */
async function hasPermission(userId, permission) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT 1
       FROM user_roles ur
       JOIN role_permissions rp ON ur.role_id = rp.role_id
       WHERE ur.user_id = $1 AND rp.permission = $2
       LIMIT 1`,
      [userId, permission]
    );
    return res.rowCount > 0;
  } finally {
    client.release();
  }
}

/**
 * HTTP authorization helper for the native http module.
 * It extracts a bearer token, validates the associated user, and checks a required permission.
 * @param {import('http').IncomingMessage} req - The incoming request.
 * @param {string} requiredPermission - Permission needed to proceed.
 * @returns {Promise<{ authorized: boolean, userId?: number, error?: string }>} - Result object.
 */
async function authorize(req, requiredPermission) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authorized: false, error: 'Missing or malformed Authorization header' };
  }
  const token = authHeader.slice('Bearer '.length).trim();
  // Token validation is out of scope; assume token is the user ID for simplicity.
  const userId = Number(token);
  if (Number.isNaN(userId)) {
    return { authorized: false, error: 'Invalid token format' };
  }
  const permitted = await hasPermission(userId, requiredPermission);
  if (!permitted) {
    return { authorized: false, error: 'Insufficient permissions' };
  }
  return { authorized: true, userId };
}

module.exports = { getUserRoles, hasPermission, authorize };
