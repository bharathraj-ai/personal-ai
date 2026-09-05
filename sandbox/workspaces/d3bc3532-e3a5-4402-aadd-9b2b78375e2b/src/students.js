const express = require('express');
const router = express.Router();
const db = require('../db'); // assumed to expose a query method returning Promises

/**
 * List all students.
 * @returns {Promise<Array>} Array of student objects.
 */
async function listStudents() {
  const rows = await db.query('SELECT * FROM students');
  return rows;
}

/**
 * Get a single student by ID.
 * @param {number|string} id - Student identifier.
 * @returns {Promise<Object|null>} Student object or null if not found.
 */
async function getStudentById(id) {
  const rows = await db.query('SELECT * FROM students WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * Create a new student record.
 * @param {Object} data - Student data (e.g., name, age, email).
 * @returns {Promise<Object>} The newly created student record.
 */
async function createStudent(data) {
  const { name, age, email } = data;
  const result = await db.query(
    `INSERT INTO students (name, age, email)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, age, email]
  );
  return result[0];
}

/**
 * Update an existing student record.
 * @param {number|string} id - Student identifier.
 * @param {Object} data - Fields to update.
 * @returns {Promise<Object|null>} Updated student record or null if not found.
 */
async function updateStudent(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }
  if (fields.length === 0) {
    return getStudentById(id);
  }
  values.push(id);
  const query = `UPDATE students SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
  const result = await db.query(query, values);
  return result[0] || null;
}

// Express route handlers
router.get('/', async (req, res) => {
  try {
    const students = await listStudents();
    res.json(students);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve students' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const student = await getStudentById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve student' });
  }
});

router.post('/', async (req, res) => {
  try {
    const newStudent = await createStudent(req.body);
    res.status(201).json(newStudent);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create student' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updated = await updateStudent(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Student not found' });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

module.exports = { router, listStudents, getStudentById, createStudent, updateStudent };
