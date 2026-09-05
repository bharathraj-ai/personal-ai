import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import {
  createStudent,
  getStudent,
  updateStudent,
  deleteStudent,
  listStudents,
  closePool,
} from '../src/students.js';

// Helper to generate a random email to avoid collisions
function randomEmail() {
  return `student_${Date.now()}_${Math.floor(Math.random() * 1000)}@example.com`;
}

let testStudentId = null;
let testEmail = null;

before(async () => {
  // Ensure the test table is clean before starting
  // Assuming src/students.js uses a pg Pool that we can close after tests
});

after(async () => {
  // Clean up any leftover test data and close DB connections
  if (testStudentId) {
    try {
      await deleteStudent(testStudentId);
    } catch (_) {}
  }
  await closePool();
});

describe('Student CRUD operations', async () => {
  test('Create a student', async () => {
    testEmail = randomEmail();
    const student = await createStudent({
      name: 'Test Student',
      email: testEmail,
      age: 20,
    });
    assert.ok(student.id, 'Created student should have an id');
    assert.strictEqual(student.name, 'Test Student');
    assert.strictEqual(student.email, testEmail);
    assert.strictEqual(student.age, 20);
    testStudentId = student.id;
  });

  test('Read the created student', async () => {
    const student = await getStudent(testStudentId);
    assert.ok(student, 'Student should be retrieved');
    assert.strictEqual(student.id, testStudentId);
    assert.strictEqual(student.email, testEmail);
  });

  test('Update the student', async () => {
    const newName = 'Updated Student';
    const updated = await updateStudent(testStudentId, { name: newName });
    assert.ok(updated, 'Update operation should succeed');
    const fetched = await getStudent(testStudentId);
    assert.strictEqual(fetched.name, newName);
  });

  test('List students includes the test student', async () => {
    const students = await listStudents();
    const found = students.find((s) => s.id === testStudentId);
    assert.ok(found, 'Created student should appear in list');
  });

  test('Delete the student', async () => {
    const deleted = await deleteStudent(testStudentId);
    assert.ok(deleted, 'Delete operation should succeed');
    const after = await getStudent(testStudentId);
    assert.strictEqual(after, null, 'Student should no longer exist');
    // Reset for after hook cleanup
    testStudentId = null;
  });
});
