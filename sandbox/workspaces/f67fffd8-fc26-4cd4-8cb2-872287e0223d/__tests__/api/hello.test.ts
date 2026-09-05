import handler from '../../pages/api/hello';
import { createMocks } from 'node-mocks-http';

test('GET /api/hello returns 200 with greeting', () => {
  const { req, res } = createMocks({ method: 'GET' });
  // @ts-ignore - handler expects NextApiRequest/Response which are compatible with mocks
  handler(req, res);
  expect(res._getStatusCode()).toBe(200);
  const data = JSON.parse(res._getData() as string);
  expect(data).toEqual({ message: 'Hello, world!' });
});
