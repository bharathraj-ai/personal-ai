import { Pool } from 'pg';

// Create a connection pool. Configuration is taken from environment variables.
// Typical usage: DATABASE_URL=postgres://user:password@host:port/dbname
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Retrieve all teachers.
 * @returns {Promise<Array<Object>>} Array of teacher rows.
 */
export async function listTeachers() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM teachers ORDER BY id');
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * Retrieve a single teacher by id.
 * @param {number|string} id - Teacher identifier.
 * @returns {Promise<Object|null>} Teacher row or null if not found.
 */
export async function getTeacher(id) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM teachers WHERE id = $1', [id]);
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Create a new teacher.
 * @param {Object} data - Teacher data (e.g., { name, subject }).
 * @returns {Promise<Object>} The inserted teacher row.
 */
export async function createTeacher(data) {
  const { name, subject } = data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO teachers (name, subject)
       VALUES ($1, $2)
       RETURNING *`,
      [name, subject]
    );
    return res.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Update an existing teacher.
 * @param {number|string} id - Teacher identifier.
 * @param {Object} data - Fields to update (e.g., { name, subject }).
 * @returns {Promise<Object|null>} Updated teacher row or null if not found.
 */
export async function updateTeacher(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  if (fields.length === 0) {
    // Nothing to update; return the existing record.
    return getTeacher(id);
  }

  // Add id as the last parameter.
  values.push(id);

  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE teachers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}
