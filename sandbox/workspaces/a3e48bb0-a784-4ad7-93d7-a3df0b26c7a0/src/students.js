const { Pool } = require('pg');

// Create a connection pool. The connection string should be provided via the DATABASE_URL environment variable.
// If not set, pg will fall back to default connection parameters.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Retrieve all students.
 * @returns {Promise<Array<Object>>} Array of student rows.
 */
async function listStudents() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM students ORDER BY id');
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * Retrieve a single student by id.
 * @param {number} id - Student identifier.
 * @returns {Promise<Object|null>} Student row or null if not found.
 */
async function getStudent(id) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM students WHERE id = $1', [id]);
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Add a new student.
 * @param {Object} student - Student data (e.g., { name, age, email }).
 * @returns {Promise<Object>} The inserted student row.
 */
async function addStudent(student) {
  const { name, age, email } = student;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO students (name, age, email)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, age, email]
    );
    return res.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Edit an existing student.
 * @param {number} id - Identifier of the student to update.
 * @param {Object} updates - Fields to update (e.g., { name, age, email }).
 * @returns {Promise<Object|null>} Updated student row or null if not found.
 */
async function editStudent(id, updates) {
  // Build dynamic SET clause based on provided fields.
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }
  if (fields.length === 0) {
    // Nothing to update; just return the existing record.
    return getStudent(id);
  }
  // Append id as the last parameter.
  values.push(id);
  const setClause = fields.join(', ');
  const query = `UPDATE students SET ${setClause} WHERE id = $${idx} RETURNING *`;

  const client = await pool.connect();
  try {
    const res = await client.query(query, values);
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}

module.exports = {
  listStudents,
  getStudent,
  addStudent,
  editStudent,
};