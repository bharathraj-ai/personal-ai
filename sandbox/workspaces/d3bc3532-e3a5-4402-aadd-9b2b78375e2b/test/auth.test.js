const request = require('supertest');
const app = require('../app'); // Adjust the path to your Express app

describe('Authentication Endpoints', () => {
  let authCookie = '';

  test('POST /login - success', async () => {
    const response = await request(app)
      .post('/login')
      .send({ username: 'testuser', password: 'testpass' })
      .expect(200);

    // Expect a session cookie to be set
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    authCookie = cookies.find(c => c.startsWith('session='));
    expect(authCookie).toBeDefined();
    expect(response.body).toHaveProperty('message', 'Login successful');
  });

  test('POST /login - failure with wrong credentials', async () => {
    await request(app)
      .post('/login')
      .send({ username: 'testuser', password: 'wrongpass' })
      .expect(401);
  });

  test('GET /session - authenticated', async () => {
    const response = await request(app)
      .get('/session')
      .set('Cookie', authCookie)
      .expect(200);
    expect(response.body).toHaveProperty('user');
    expect(response.body.user).toHaveProperty('username', 'testuser');
  });

  test('GET /session - unauthenticated', async () => {
    await request(app)
      .get('/session')
      .expect(401);
  });

  test('POST /logout - success', async () => {
    const response = await request(app)
      .post('/logout')
      .set('Cookie', authCookie)
      .expect(200);
    expect(response.body).toHaveProperty('message', 'Logout successful');
  });

  test('GET /session after logout - should be unauthorized', async () => {
    await request(app)
      .get('/session')
      .set('Cookie', authCookie)
      .expect(401);
  });
});