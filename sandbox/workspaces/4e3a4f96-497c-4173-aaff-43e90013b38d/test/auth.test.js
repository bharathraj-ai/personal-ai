/**
 * Authentication tests
 *
 * This test suite assumes the existence of an Express app exposing the
 * following endpoints:
 *   POST /api/login   - accepts JSON { username, password } and returns a JWT token
 *   GET  /api/profile - protected route that requires a valid JWT in the Authorization header
 *
 * The actual implementation of the server is not provided here; this file
 * contains only the test definitions. Adjust the import paths and request
 * details to match your project's structure.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

// Adjust the path to your Express app as needed
const app = require('../src/app'); // placeholder path

// Example user credentials – replace with valid test credentials for your app
const testUser = {
  username: 'testuser',
  password: 'testpassword',
};

// Secret used for signing JWTs in the application – must match the server config
// In real tests you would import this from a config module or use a test secret.
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

describe('Authentication', () => {
  let token = '';

  test('POST /api/login should return a JWT token for valid credentials', async () => {
    const response = await request(app)
      .post('/api/login')
      .send(testUser)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toHaveProperty('token');
    token = response.body.token;

    // Verify token structure (optional)
    const decoded = jwt.verify(token, JWT_SECRET);
    expect(decoded).toHaveProperty('sub'); // subject claim, e.g., user id
    expect(decoded.sub).toBeTruthy();
  });

  test('GET /api/profile should reject requests without a token', async () => {
    await request(app)
      .get('/api/profile')
      .expect(401);
  });

  test('GET /api/profile should allow access with a valid token', async () => {
    const response = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect('Content-Type', /json/)
      .expect(200);

    // The shape of the profile response depends on your implementation.
    // Adjust the expectations accordingly.
    expect(response.body).toHaveProperty('username', testUser.username);
  });
});
