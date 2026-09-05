const request = require('supertest');
const app = require('./app');

describe('GET /hello', () => {
  it('should respond with JSON message', async () => {
    const response = await request(app).get('/hello');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Hello, world!' });
    expect(response.headers['content-type']).toMatch(/json/);
  });
});
