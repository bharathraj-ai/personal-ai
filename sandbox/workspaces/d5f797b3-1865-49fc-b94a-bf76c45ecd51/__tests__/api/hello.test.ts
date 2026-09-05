import handler from '../../pages/api/hello';

test('GET /api/hello returns greeting', async () => {
  const req = { method: 'GET' } as any;
  const jsonMock = jest.fn();
  const statusMock = jest.fn(() => ({ json: jsonMock }));
  const res = {
    status: statusMock,
    json: jsonMock,
  } as any;

  await handler(req, res);

  expect(statusMock).toHaveBeenCalledWith(200);
  expect(jsonMock).toHaveBeenCalledWith({ message: 'Hello, world!' });
});
