const request = require('supertest');
const app = require('../src/app'); // adjust path if needed

/**
 * Integration tests for the Student CRUD API.
 * Assumes a real database connection is configured.
 */

describe('Student CRUD API', () => {
  let createdId;

  afterAll(async () => {
    // optional: close DB connections if app provides a method
    if (app.close) {
      await app.close();
    }
  });

  test('POST /students creates a new student', async () => {
    const res = await request(app)
      .post('/students')
      .send({ name: 'John Doe', age: 20, major: 'Computer Science' })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    createdId = res.body.id;
    expect(res.body).toMatchObject({
      name: 'John Doe',
      age: 20,
      major: 'Computer Science',
    });
  });

  test('GET /students/:id returns the created student', async () => {
    const res = await request(app)
      .get(`/students/${createdId}`)
      .expect(200);

    expect(res.body).toMatchObject({
      id: createdId,
      name: 'John Doe',
      age: 20,
      major: 'Computer Science',
    });
  });

  test('PUT /students/:id updates the student', async () => {
    const res = await request(app)
      .put(`/students/${createdId}`)
      .send({ name: 'Jane Doe', age: 21 })
      .expect(200);

    expect(res.body).toMatchObject({
      id: createdId,
      name: 'Jane Doe',
      age: 21,
      major: 'Computer Science',
    });
  });

  test('DELETE /students/:id removes the student', async () => {
    await request(app)
      .delete(`/students/${createdId}`)
      .expect(204);
  });

  test('GET /students/:id after deletion returns 404', async () => {
    await request(app)
      .get(`/students/${createdId}`)
      .expect(404);
  });
});