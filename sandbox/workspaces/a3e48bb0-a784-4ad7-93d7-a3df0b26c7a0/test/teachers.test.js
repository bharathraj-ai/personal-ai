import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { Pool } from 'pg';
import * as teachers from '../src/teachers.js';

// Configure a test database connection (environment variables should point to a test DB)
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
});

// Helper to run a query directly against the DB for cleanup/verification
async function query(sql, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    client.release();
  }
}

// Ensure the teachers table exists for the test run (basic schema)
before(async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT NOT NULL
    );
  `);
});

// Clean up after all tests
after(async () => {
  await query('DROP TABLE IF EXISTS teachers;');
  await pool.end();
});

describe('Teacher management', async () => {
  let createdId;

  test('createTeacher should insert a new teacher and return its id', async () => {
    const name = 'Ada Lovelace';
    const subject = 'Computer Science';
    createdId = await teachers.createTeacher(name, subject);
    assert.ok(createdId, 'Expected a valid teacher id');

    const { rows } = await query('SELECT * FROM teachers WHERE id = $1', [createdId]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].name, name);
    assert.strictEqual(rows[0].subject, subject);
  });

  test('getTeacher should retrieve the teacher by id', async () => {
    const teacher = await teachers.getTeacher(createdId);
    assert.ok(teacher);
    assert.strictEqual(teacher.id, createdId);
    assert.strictEqual(teacher.name, 'Ada Lovelace');
    assert.strictEqual(teacher.subject, 'Computer Science');
  });

  test('updateTeacher should modify existing teacher fields', async () => {
    const newData = { name: 'Ada Byron', subject: 'Mathematics' };
    const updated = await teachers.updateTeacher(createdId, newData);
    assert.strictEqual(updated, true, 'Expected updateTeacher to return true');

    const teacher = await teachers.getTeacher(createdId);
    assert.strictEqual(teacher.name, newData.name);
    assert.strictEqual(teacher.subject, newData.subject);
  });

  test('deleteTeacher should remove the teacher from the database', async () => {
    const deleted = await teachers.deleteTeacher(createdId);
    assert.strictEqual(deleted, true, 'Expected deleteTeacher to return true');

    const { rows } = await query('SELECT * FROM teachers WHERE id = $1', [createdId]);
    assert.strictEqual(rows.length, 0);
  });
});
