const request = require('supertest');
const app = require('../app'); // Adjust the path to your Express app

describe('Authentication', () => {
  test('should login with valid credentials', async () => {
    const response = await request(app)
      .post('/login')
      .send({ username: 'testuser', password: 'testpass' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('token');
  });

  test('should reject invalid credentials', async () => {
    const response = await request(app)
      .post('/login')
      .send({ username: 'testuser', password: 'wrongpass' });
    expect(response.statusCode).toBe(401);
  });
});