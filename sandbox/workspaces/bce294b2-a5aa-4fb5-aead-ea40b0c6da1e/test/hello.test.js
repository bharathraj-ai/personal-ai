const request = require('supertest');
const app = require('../index');

describe('GET /hello', () => {
  it('should return 200 OK with {"message":"Hello, world!"}', async () => {
    const response = await request(app)
      .get('/hello')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({ message: 'Hello, world!' });
  });
});
