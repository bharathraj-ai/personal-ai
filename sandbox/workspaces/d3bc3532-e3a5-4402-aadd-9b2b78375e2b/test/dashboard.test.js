const request = require('supertest');
const app = require('../app'); // Adjust the path to your Express app if needed

describe('GET /api/dashboard', () => {
  const roles = ['Admin', 'Teacher', 'Student', 'Parent'];

  roles.forEach((role) => {
    test(`should return ${role.toLowerCase()} dashboard for role ${role}`, async () => {
      const response = await request(app)
        .get('/api/dashboard')
        .set('x-user-role', role) // Assuming the app reads role from this header
        .expect('Content-Type', /json/)
        .expect(200);

      // Basic shape assertions – adjust according to your actual response format
      expect(response.body).toHaveProperty('dashboard');
      expect(response.body.dashboard).toHaveProperty('role', role);
    });
  });

  test('should return 401 when role header is missing', async () => {
    await request(app)
      .get('/api/dashboard')
      .expect(401);
  });
});
