const request = require('supertest');
const app = require('../src/app');

describe('GET /hello', () => {
  it('should respond with JSON greeting', async () => {
    const response = await request(app).get('/hello');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Hello, world!' });
  });
});
