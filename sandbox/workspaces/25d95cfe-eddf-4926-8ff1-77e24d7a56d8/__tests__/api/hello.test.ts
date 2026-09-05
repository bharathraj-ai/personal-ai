import handler from '../../pages/api/hello';
import { createMocks } from 'node-mocks-http';

describe('API Route /api/hello', () => {
  test('returns 200 and correct JSON', async () => {
    const { req, res } = createMocks({
      method: 'GET',
    });

    // @ts-ignore - handler expects NextApiRequest/Response which node-mocks-http provides
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toEqual({ message: 'Hello, world!' });
  });
});
