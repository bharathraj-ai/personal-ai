import handler from '../../pages/api/hello';
import { createMocks } from 'node-mocks-http';

describe('API Route Hello', () => {
  test('returns 200 and message on GET', () => {
    const { req, res } = createMocks({
      method: 'GET',
    });
    handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toEqual({ message: 'Hello, world!' });
  });

  test('returns 405 on POST', () => {
    const { req, res } = createMocks({
      method: 'POST',
    });
    handler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(res._getData()).toBe('Method POST Not Allowed');
  });
});
